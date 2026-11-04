/**
 * Áp `booking.modified` (AC7) — cập nhật **toàn bộ** đêm/quota/demand/snapshot trong một transaction,
 * **không** chạy đường đổi ngày của khách (`book/reschedule`): không sinh `RESCHEDULE_FEE`/`PENALTY`,
 * không tăng `reschedule_count`, không áp policy nội bộ (BR-CHAN-03).
 *
 * Thứ tự: nhả assignment cũ → cập nhật booking → void ROOM charges cũ + nhả phân bổ → đồng bộ
 * `booking_rooms` + gán lại đơn vị thật trống → charge mới + snapshot RESCHEDULE kế tiếp → phân bổ lại
 * khoản thu đã có (không tạo khoản thu thứ hai). `price_snapshots` là bằng chứng giá bất biến của lần
 * sửa; `providerUpdatedAt` của sự kiện được lưu trong payload của snapshot để so thứ tự lần sau.
 */
import type { Prisma } from '@prisma/client';
import type { UnitIdentity } from '@pinehill/domain/inventory';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { systemActor } from './actor.js';
import { chargeCells } from './amounts.js';
import { reallocateCollections } from './collection.js';
import { stayNights } from './payload.js';
import type { OtaPayload } from './payload.js';
import type { OtaPricing } from './pricing.js';
import type { OtaScope } from './scope.js';
import { insertCharges, insertSnapshot, syncRoomRows } from './rooms.js';
import type { OtaInboxDeps } from './types.js';
import type { EventEnvelope } from './create.js';

type Tx = Prisma.TransactionClient;

export interface ModifyInput {
  readonly deps: OtaInboxDeps;
  readonly scope: OtaScope;
  readonly payload: OtaPayload;
  readonly envelope: EventEnvelope;
  readonly pricing: OtaPricing;
  readonly units: readonly UnitIdentity[];
  readonly bookingId: string;
  /** Trạng thái đã đọc trong transaction trước khi sửa. */
  readonly previous: {
    readonly checkIn: string;
    readonly checkOut: string;
    readonly roomCount: number;
  };
  readonly now: Date;
}

async function releaseAssignments(tx: Tx, bookingId: string, now: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE room_assignments
       SET released_at = ${now}, release_reason = 'OTA_MODIFY', updated_at = ${now}
     WHERE released_at IS NULL
       AND booking_room_id IN (SELECT id FROM booking_rooms WHERE booking_id = ${bookingId}::uuid)`;
}

/**
 * Bản ghi assignment của lần sửa trước bị thay thế, không giữ lại: `room_assignments` không có bảng
 * lịch sử và `assignmentsOf` của hợp đồng AC8 đếm **đơn vị đang/đã gán của booking**. Bằng chứng của
 * lần đổi kỳ nằm ở `price_snapshots` + audit.
 */
async function dropSupersededAssignments(tx: Tx, bookingId: string): Promise<void> {
  await tx.$executeRaw`
    DELETE FROM room_assignments
     WHERE release_reason = 'OTA_MODIFY'
       AND booking_room_id IN (SELECT id FROM booking_rooms WHERE booking_id = ${bookingId}::uuid)`;
}

async function voidRoomCharges(tx: Tx, bookingId: string, now: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE payment_allocations
       SET released_amount = amount, release_reason = 'OTA_MODIFY', updated_at = ${now}
     WHERE charge_id IN (SELECT id FROM booking_charges WHERE booking_id = ${bookingId}::uuid)`;
  await tx.$executeRaw`
    UPDATE booking_charges
       SET voided_amount = amount, updated_at = ${now}
     WHERE booking_id = ${bookingId}::uuid AND kind = 'ROOM' AND amount > voided_amount`;
}

async function nextSnapshotSeq(tx: Tx, bookingId: string): Promise<number> {
  const row = (
    await tx.$queryRaw<
      { seq: number }[]
    >`SELECT (COALESCE(MAX(seq), 0) + 1)::int AS seq FROM price_snapshots WHERE booking_id = ${bookingId}::uuid`
  )[0];
  if (row === undefined) throw new Error('price_snapshots sequence unavailable');
  return row.seq;
}

export async function modifyBooking(tx: Tx, input: ModifyInput): Promise<string> {
  const { payload, scope, pricing, now, envelope } = input;
  const nights = stayNights(payload.checkIn, payload.checkOut);
  const cells = chargeCells(pricing.total, pricing.nightlyPrices, payload.roomCount);
  const oversold = input.units.length < payload.roomCount;
  await releaseAssignments(tx, input.bookingId, now);
  await dropSupersededAssignments(tx, input.bookingId);
  await tx.bookings.update({
    where: { id: input.bookingId },
    data: {
      check_in: new Date(`${payload.checkIn}T00:00:00.000Z`),
      check_out: new Date(`${payload.checkOut}T00:00:00.000Z`),
      adults: payload.adults,
      children: payload.children,
      room_count: payload.roomCount,
      total_amount: pricing.total,
      oversold,
      channel_policy_code: pricing.channelPolicyCode,
      note:
        payload.note === null || payload.note === undefined
          ? null
          : maskOperationalText(payload.note),
      updated_at: now,
    },
  });
  await voidRoomCharges(tx, input.bookingId, now);
  const seq = await nextSnapshotSeq(tx, input.bookingId);
  const roomIds = await syncRoomRows(tx, {
    bookingId: input.bookingId,
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
  await insertCharges(tx, { bookingId: input.bookingId, roomIds, nights, cells, seq, now });
  await insertSnapshot(tx, {
    bookingId: input.bookingId,
    seq,
    kind: 'RESCHEDULE',
    total: pricing.total,
    payload: {
      channelCode: payload.channelCode,
      providerAccountId: envelope.accountId,
      providerBookingCode: payload.providerBookingCode,
      providerUpdatedAt: payload.providerUpdatedAt,
      payloadHash: envelope.payloadHash,
      eventType: payload.eventType,
      currency: payload.currency,
      amount: Number(pricing.total),
      roomCount: payload.roomCount,
      engineVersion: pricing.engineVersion,
      nights: nights.map((date, index) => ({
        date,
        nightlyPrice: pricing.nightlyPrices[index] ?? 0,
      })),
    },
    policy: {
      channelPolicyCode: pricing.channelPolicyCode,
      ratePlanId: pricing.ratePlanId,
      depositPercent: pricing.depositPercent,
      cancelReason: 'OTA_CANCELLATION',
    },
    engineVersion: pricing.engineVersion,
    now,
  });
  await reallocateCollections(tx, input.deps, {
    bookingId: input.bookingId,
    now,
    correlationId: envelope.eventId,
  });
  await input.deps.audit.record(tx, {
    actor: systemActor(envelope.eventId),
    action: 'BOOKING_MODIFIED',
    entityType: 'Booking',
    entityId: input.bookingId,
    beforeJson: {
      propertyId: scope.propertyId,
      checkIn: input.previous.checkIn,
      checkOut: input.previous.checkOut,
      roomCount: input.previous.roomCount,
    },
    afterJson: {
      propertyId: scope.propertyId,
      checkIn: payload.checkIn,
      checkOut: payload.checkOut,
      roomCount: payload.roomCount,
      totalAmount: pricing.total.toString(),
      providerUpdatedAt: payload.providerUpdatedAt,
      oversold,
      snapshotSeq: seq,
    },
    reason: null,
  });
  await tx.outbox_events.create({
    data: {
      event_type: 'InventoryChanged',
      aggregate_type: 'Booking',
      aggregate_id: input.bookingId,
      payload_json: {
        propertyId: scope.propertyId,
        roomTypeId: scope.roomTypeId,
        startDate: payload.checkIn,
        endDate: payload.checkOut,
        operation: 'BOOKING_MODIFIED',
      },
    },
  });
  return input.bookingId;
}
