/**
 * Áp `booking.created` (AC1/AC2/AC3/AC4) — tạo thẳng booking `CONFIRMED` từ cam kết OTA **đã thu hộ**:
 *
 * 1. khách theo SĐT chuẩn hoá (BR-CRM-01) + nghi trùng BR-BOOK-16 (chỉ **gắn cờ**, không gộp/xoá);
 * 2. `bookings` CONFIRMED (không hold/cọc PSP, `hold_expires_at = null`) với `external_ref` canonical
 *    `property/account/providerCode` — UNIQUE `(channel_id, external_ref)` là dedup **bền** vượt
 *    retention 7 ngày của inbox (AC4);
 * 3. `booking_rooms` cho **mọi** đơn vị bán + `room_assignments` chỉ cho đơn vị thật trống cả kỳ;
 * 4. `booking_charges` ROOM theo giá engine + `price_snapshots` ORIGINAL (bất biến giá, BR-RATE-16);
 * 5. khoản thu `OTA_COLLECT` qua sổ cái HB-093 (AC1) + history + audit + outbox.
 *
 * Quota/đóng bán/tồn 0 **không** chặn đường này (BR-CHAN-08, AC2): quyết định đã nằm ở phía kênh.
 */
import type { Prisma } from '@prisma/client';
import type { UnitIdentity } from '@pinehill/domain/inventory';
import { findDuplicateBooking } from '../../book/bookings/duplicate.js';
import { bookingCode } from '../../book/holds/writes.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { systemActor } from './actor.js';
import { chargeCells } from './amounts.js';
import { OTA_DUPLICATE_FLAG_ACTION } from './codes.js';
import { recordOtaCollection } from './collection.js';
import { resolveGuest } from './guest.js';
import { stayNights } from './payload.js';
import type { OtaPayload } from './payload.js';
import type { OtaPricing } from './pricing.js';
import type { OtaScope } from './scope.js';
import { insertCharges, insertRoomRows, insertSnapshot } from './rooms.js';
import type { OtaInboxDeps } from './types.js';

type Tx = Prisma.TransactionClient;

/** Định danh bền của sự kiện trong hàng inbox — dùng cho khoá tự nhiên và snapshot. */
export interface EventEnvelope {
  readonly eventId: string;
  readonly provider: string;
  readonly accountId: string;
  readonly payloadHash: string;
}

/** Khoá tự nhiên của booking OTA: mã của kênh chỉ duy nhất **trong** account/cơ sở (AC4). */
export function externalRefOf(payload: OtaPayload, accountId: string): string {
  return `${payload.propertyCode}/${accountId}/${payload.providerBookingCode}`;
}

export interface CreateInput {
  readonly deps: OtaInboxDeps;
  readonly scope: OtaScope;
  readonly payload: OtaPayload;
  readonly envelope: EventEnvelope;
  readonly pricing: OtaPricing;
  readonly units: readonly UnitIdentity[];
  readonly phone: string;
  readonly placeholderPhone: boolean;
  readonly now: Date;
}

function snapshotPayload(input: CreateInput, nights: readonly string[]): Prisma.InputJsonValue {
  return {
    channelCode: input.payload.channelCode,
    providerAccountId: input.envelope.accountId,
    providerBookingCode: input.payload.providerBookingCode,
    providerUpdatedAt: input.payload.providerUpdatedAt,
    payloadHash: input.envelope.payloadHash,
    eventType: input.payload.eventType,
    currency: input.payload.currency,
    amount: Number(input.pricing.total),
    roomCount: input.payload.roomCount,
    engineVersion: input.pricing.engineVersion,
    nights: nights.map((date, index) => ({
      date,
      nightlyPrice: input.pricing.nightlyPrices[index] ?? 0,
    })),
  };
}

function policySnapshot(input: CreateInput): Prisma.InputJsonValue {
  return {
    channelPolicyCode: input.pricing.channelPolicyCode,
    ratePlanId: input.pricing.ratePlanId,
    depositPercent: input.pricing.depositPercent,
    cancelReason: 'OTA_CANCELLATION',
  };
}

async function insertBookingRow(
  tx: Tx,
  input: CreateInput,
  guestId: string,
  oversold: boolean,
): Promise<string> {
  const sequence = (
    await tx.$queryRaw<{ seq: bigint }[]>`SELECT nextval('bookings_seq') AS seq`
  )[0];
  if (sequence === undefined) throw new Error('bookings_seq is unavailable');
  const booking = await tx.bookings.create({
    data: {
      code: bookingCode(sequence.seq, input.now),
      seq: sequence.seq,
      guest_id: guestId,
      property_id: input.scope.propertyId,
      room_type_id: input.scope.roomTypeId,
      rate_plan_id: input.pricing.ratePlanId,
      channel_id: input.scope.channelId,
      check_in: new Date(`${input.payload.checkIn}T00:00:00.000Z`),
      check_out: new Date(`${input.payload.checkOut}T00:00:00.000Z`),
      adults: input.payload.adults,
      children: input.payload.children,
      status: 'CONFIRMED',
      room_count: input.payload.roomCount,
      total_amount: input.pricing.total,
      deposit_percent: input.pricing.depositPercent,
      deposit_amount: 0n,
      paid_amount: 0n,
      balance_due: input.pricing.total,
      currency: 'VND',
      hold_expires_at: null,
      oversold,
      external_ref: externalRefOf(input.payload, input.envelope.accountId),
      channel_policy_code: input.pricing.channelPolicyCode,
      note:
        input.payload.note === null || input.payload.note === undefined
          ? null
          : maskOperationalText(input.payload.note),
      created_by: null,
      created_at: input.now,
      updated_at: input.now,
    },
    select: { id: true },
  });
  return booking.id;
}

async function flagDuplicate(tx: Tx, input: CreateInput, bookingId: string): Promise<void> {
  await tx.bookings.update({
    where: { id: bookingId },
    data: {
      duplicate_suspected: true,
      duplicate_suspected_reason:
        'BR-BOOK-16: cùng kênh/SĐT/loại phòng/ngày nhận phòng trong 24 giờ',
      duplicate_suspected_at: input.now,
      updated_at: input.now,
    },
  });
  await input.deps.audit.record(tx, {
    actor: systemActor(input.envelope.eventId),
    action: OTA_DUPLICATE_FLAG_ACTION,
    entityType: 'Booking',
    entityId: bookingId,
    beforeJson: { propertyId: input.scope.propertyId, duplicateSuspected: false },
    afterJson: { propertyId: input.scope.propertyId, duplicateSuspected: true },
    reason: 'Suspected duplicate OTA commitment; booking kept, not merged',
  });
}

export async function createBooking(tx: Tx, input: CreateInput): Promise<string> {
  const { payload, scope, pricing, now, envelope } = input;
  const guestId = await resolveGuest(tx, {
    fullName: payload.guest.fullName,
    phone: input.phone,
    placeholder: input.placeholderPhone,
    now,
  });
  // BR-BOOK-16: chỉ cờ nghi trùng — cam kết OTA không bị gộp/xoá (AC4).
  const duplicate = await findDuplicateBooking(tx, {
    channelId: scope.channelId,
    roomTypeId: scope.roomTypeId,
    checkIn: payload.checkIn,
    guestId,
    phone: input.phone,
  });
  const nights = stayNights(payload.checkIn, payload.checkOut);
  const cells = chargeCells(pricing.total, pricing.nightlyPrices, payload.roomCount);
  const oversold = input.units.length < payload.roomCount;
  const bookingId = await insertBookingRow(tx, input, guestId, oversold);
  const roomIds = await insertRoomRows(tx, {
    bookingId,
    roomTypeId: scope.roomTypeId,
    roomCount: payload.roomCount,
    adults: payload.adults,
    children: payload.children,
    pricePerNight: pricing.nightlyPrices[0] ?? 0,
    units: input.units,
    checkIn: payload.checkIn,
    checkOut: payload.checkOut,
    now,
  });
  await insertCharges(tx, { bookingId, roomIds, nights, cells, seq: 1, now });
  await insertSnapshot(tx, {
    bookingId,
    seq: 1,
    kind: 'ORIGINAL',
    total: pricing.total,
    payload: snapshotPayload(input, nights),
    policy: policySnapshot(input),
    engineVersion: pricing.engineVersion,
    now,
  });
  await recordOtaCollection(tx, input.deps, {
    bookingId,
    total: pricing.total,
    accountKey: envelope.accountId,
    providerBookingCode: payload.providerBookingCode,
    providerUpdatedAt: payload.providerUpdatedAt,
    now,
    correlationId: envelope.eventId,
  });
  await tx.booking_status_history.create({
    data: {
      booking_id: bookingId,
      from_status: 'DRAFT',
      to_status: 'CONFIRMED',
      reason: 'OTA_COLLECT',
      actor_id: null,
      at: now,
    },
  });
  await input.deps.audit.record(tx, {
    actor: systemActor(envelope.eventId),
    action: 'BOOKING_CREATED',
    entityType: 'Booking',
    entityId: bookingId,
    beforeJson: null,
    afterJson: {
      propertyId: scope.propertyId,
      roomTypeId: scope.roomTypeId,
      channelId: scope.channelId,
      channelCode: payload.channelCode,
      providerBookingCode: payload.providerBookingCode,
      providerUpdatedAt: payload.providerUpdatedAt,
      checkIn: payload.checkIn,
      checkOut: payload.checkOut,
      roomCount: payload.roomCount,
      status: 'CONFIRMED',
      totalAmount: pricing.total.toString(),
      oversold,
      paymentMethod: 'OTA_COLLECT',
    },
    reason: null,
  });
  if (duplicate !== null) await flagDuplicate(tx, input, bookingId);
  await tx.outbox_events.create({
    data: {
      event_type: 'InventoryChanged',
      aggregate_type: 'Booking',
      aggregate_id: bookingId,
      payload_json: {
        propertyId: scope.propertyId,
        roomTypeId: scope.roomTypeId,
        startDate: payload.checkIn,
        endDate: payload.checkOut,
        operation: 'BOOKING_CREATED',
      },
    },
  });
  return bookingId;
}
