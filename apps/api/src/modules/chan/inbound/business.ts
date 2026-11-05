/**
 * Điều phối nghiệp vụ một hàng inbox **đã xác minh** (AC1–AC5, AC7–AC9, AC11).
 *
 * Mọi bước chạy trong transaction của `OtaInboxApplier`: khoá tài nguyên ADR-014 **trước** quyết định
 * tồn/quota, rồi mới rẽ nhánh theo `eventType`. Kết cục là một trong ba loại — áp xong, bỏ qua (sự kiện
 * cũ/phát lại), hoặc cách ly đối soát — để tầng trên đóng trạng thái inbox tương ứng.
 */
import type { Prisma } from '@prisma/client';
import { lockStock } from '../../book/holds/lock.js';
import type { InboxRecord } from './inbox.js';
import { systemActor } from './actor.js';
import { applyCancellation } from './cancel.js';
import { OTA_CODE, OTA_QUOTA_WARNING_ACTION } from './codes.js';
import { createBooking, externalRefOf } from './create.js';
import type { EventEnvelope } from './create.js';
import { guestPhoneOf } from './guest.js';
import { allotmentStates, planUnits, trackUsage } from './inventory.js';
import { modifyBooking } from './modify.js';
import { advanceWatermark, decideOrder, findTombstone, lockBookingByRef } from './order.js';
import type { WatermarkWrite } from './order.js';
import { stayNights } from './payload.js';
import type { OtaPayload } from './payload.js';
import { priceEvent } from './pricing.js';
import type { OtaPricing } from './pricing.js';
import { failed, isFailure, resolveScope } from './scope.js';
import type { OtaFailure, OtaScope } from './scope.js';
import { recordShortages } from './shortage.js';
import type { OtaInboxDeps } from './types.js';

type Tx = Prisma.TransactionClient;

export type Outcome =
  | { readonly kind: 'applied'; readonly bookingId: string | null }
  | { readonly kind: 'skip'; readonly reason: string }
  | { readonly kind: 'quarantine'; readonly reason: string };

const applied = (bookingId: string | null): Outcome => ({ kind: 'applied', bookingId });
const skipped = (reason: string): Outcome => ({ kind: 'skip', reason });
const quarantined = (reason: string): Outcome => ({ kind: 'quarantine', reason });

interface EventContext {
  readonly deps: OtaInboxDeps;
  readonly row: InboxRecord;
  readonly payload: OtaPayload;
  readonly scope: OtaScope;
  readonly now: Date;
}

function envelopeOf(row: InboxRecord): EventEnvelope {
  return {
    eventId: row.eventId,
    provider: row.provider,
    accountId: row.accountId,
    payloadHash: row.payloadHash,
  };
}

function watermarkOf(context: EventContext): WatermarkWrite {
  return {
    channelId: context.scope.channelId,
    accountKey: context.row.accountId,
    provider: context.row.provider,
    watermarkAt: new Date(context.payload.providerUpdatedAt),
    eventId: context.row.eventId,
    now: context.now,
  };
}

export async function applyEventPayload(
  tx: Tx,
  deps: OtaInboxDeps,
  row: InboxRecord,
  payload: OtaPayload,
  now: Date,
): Promise<Outcome> {
  // AC11: account của hàng inbox và account khai trong payload phải là một.
  if (payload.providerAccountId !== row.accountId) return quarantined(OTA_CODE.accountMismatch);
  const scope = await resolveScope(tx, payload);
  if (isFailure(scope)) return quarantined(scope.reason);
  await lockStock(tx, scope.propertyId, scope.roomTypeId);
  const context: EventContext = { deps, row, payload, scope, now };
  return payload.eventType === 'booking.cancelled'
    ? applyCancel(tx, context)
    : applyCommitment(tx, context);
}

/**
 * AC8/AC9: cancel thắng modify và không phụ thuộc thứ tự; booking chưa có ⇒ tombstone bền. Giải phóng
 * `used` đúng một lần bằng mốc kỳ **đã lưu** của booking, không theo payload đến muộn.
 */
async function applyCancel(tx: Tx, context: EventContext): Promise<Outcome> {
  const { deps, row, payload, scope, now } = context;
  const booking = await lockBookingByRef(
    tx,
    scope.channelId,
    externalRefOf(payload, row.accountId),
  );
  const envelope = envelopeOf(row);
  if (booking === null) {
    const bookingId = await applyCancellation(tx, {
      deps,
      scope,
      payload,
      envelope,
      booking: null,
      now,
    });
    await advanceWatermark(tx, watermarkOf(context));
    return applied(bookingId);
  }
  if (booking.status === 'CANCELLED') {
    await advanceWatermark(tx, watermarkOf(context));
    return skipped(OTA_CODE.cancellationWins);
  }
  const bookingId = await applyCancellation(tx, {
    deps,
    scope,
    payload,
    envelope,
    booking: {
      id: booking.id,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      roomCount: booking.roomCount,
      channelPolicyCode: booking.channelPolicyCode,
    },
    now,
  });
  await trackUsage(tx, {
    channelId: scope.channelId,
    roomTypeId: scope.roomTypeId,
    nights: stayNights(booking.checkIn, booking.checkOut),
    delta: -booking.roomCount,
    now,
  });
  await advanceWatermark(tx, watermarkOf(context));
  return applied(bookingId);
}

interface AcceptedCommitment {
  readonly pricing: OtaPricing;
  readonly phone: string;
  readonly placeholder: boolean;
}

/** AC11: chỉ cam kết **đã xác nhận thu hộ**, đúng giá kênh và có SĐT hợp lệ mới thành booking. */
async function acceptedCommitment(
  tx: Tx,
  context: EventContext,
): Promise<AcceptedCommitment | OtaFailure> {
  if (!context.payload.paymentCollected) return failed(OTA_CODE.collectionUnconfirmed);
  const pricing = await priceEvent(tx, context.scope, context.payload);
  if (isFailure(pricing)) return pricing;
  const phone = guestPhoneOf(
    context.payload.guest.phone,
    `${context.row.accountId}:${context.payload.providerBookingCode}`,
  );
  if (isFailure(phone)) return phone;
  return { pricing, phone: phone.phone, placeholder: phone.placeholder };
}

/** BR-CHAN-08: cam kết vượt hạn mức/đóng bán vẫn được nhận, nhưng phải có dấu đối soát SYSTEM. */
async function warnQuota(tx: Tx, context: EventContext): Promise<void> {
  const states = await allotmentStates(tx, {
    channelId: context.scope.channelId,
    roomTypeId: context.scope.roomTypeId,
    nights: stayNights(context.payload.checkIn, context.payload.checkOut),
  });
  for (const state of states) {
    if (!state.closed && state.used <= state.allotment) continue;
    await context.deps.audit.record(tx, {
      actor: systemActor(context.row.eventId),
      action: OTA_QUOTA_WARNING_ACTION,
      entityType: 'channel_allotment',
      entityId: state.id,
      beforeJson: { allotment: state.allotment, closed: state.closed },
      afterJson: {
        allotment: state.allotment,
        used: state.used,
        roomCount: context.payload.roomCount,
      },
      reason: 'OTA commitment accepted beyond published quota (BR-CHAN-08)',
    });
  }
}

async function applyCommitment(tx: Tx, context: EventContext): Promise<Outcome> {
  const { deps, row, payload, scope, now } = context;
  const booking = await lockBookingByRef(
    tx,
    scope.channelId,
    externalRefOf(payload, row.accountId),
  );
  const tombstone = await findTombstone(tx, {
    channelId: scope.channelId,
    accountKey: row.accountId,
    providerBookingCode: payload.providerBookingCode,
  });
  // AC9: dấu huỷ bền theo khoá tự nhiên — create/modify không hồi sinh, đưa sang đối soát.
  if (tombstone !== null) return quarantined(OTA_CODE.resurrection);
  if (booking !== null) {
    const decision = decideOrder(
      {
        type: payload.eventType,
        updatedAt: payload.providerUpdatedAt,
        payloadHash: row.payloadHash,
      },
      booking,
    );
    if (decision.kind === 'skip') return skipped(decision.reason);
    if (decision.kind === 'conflict') return quarantined(decision.reason);
  }
  const accepted = await acceptedCommitment(tx, context);
  if (isFailure(accepted)) return quarantined(accepted.reason);
  const plan = await planUnits(tx, {
    propertyId: scope.propertyId,
    roomTypeId: scope.roomTypeId,
    checkIn: payload.checkIn,
    checkOut: payload.checkOut,
    channelCode: payload.channelCode,
    roomCount: payload.roomCount,
  });
  const envelope = envelopeOf(row);
  const bookingId =
    booking === null
      ? await createBooking(tx, {
          deps,
          scope,
          payload,
          envelope,
          pricing: accepted.pricing,
          units: plan.units,
          phone: accepted.phone,
          placeholderPhone: accepted.placeholder,
          now,
        })
      : await modifyBooking(tx, {
          deps,
          scope,
          payload,
          envelope,
          pricing: accepted.pricing,
          units: plan.units,
          bookingId: booking.id,
          previous: {
            checkIn: booking.checkIn,
            checkOut: booking.checkOut,
            roomCount: booking.roomCount,
          },
          now,
        });
  if (booking !== null)
    await trackUsage(tx, {
      channelId: scope.channelId,
      roomTypeId: scope.roomTypeId,
      nights: stayNights(booking.checkIn, booking.checkOut),
      delta: -booking.roomCount,
      now,
    });
  await trackUsage(tx, {
    channelId: scope.channelId,
    roomTypeId: scope.roomTypeId,
    nights: stayNights(payload.checkIn, payload.checkOut),
    delta: payload.roomCount,
    now,
  });
  await warnQuota(tx, context);
  await recordShortages(tx, {
    propertyId: scope.propertyId,
    roomTypeId: scope.roomTypeId,
    checkIn: payload.checkIn,
    checkOut: payload.checkOut,
    now,
  });
  await advanceWatermark(tx, watermarkOf(context));
  return applied(bookingId);
}
