/**
 * Áp `booking.cancelled` (AC8/AC9) — huỷ OTA **không** chạy BR-CANCEL nội bộ:
 *
 * - booking đã tồn tại ⇒ `CANCELLED` + `cancelledAt` + `cancelReason = OTA_CANCELLATION` +
 *   `channelPolicyCode`, giải phóng assignment/demand **một lần** (booking_rooms đóng, không xoá),
 *   hạch toán lại sổ cái (không tạo RefundRequest/REFUND/payout — tiền hoàn do OTA xử lý);
 * - chưa có booking ⇒ chỉ ghi **tombstone** bền theo `(channel, account, providerCode)` để create/modify
 *   đến trước/sau đều không hồi sinh booking (AC9).
 */
import type { Prisma } from '@prisma/client';
import { BookingLedger } from '../../pay/ledger/service.js';
import { systemActor } from './actor.js';
import { OTA_CANCELLED_ACTION } from './codes.js';
import type { EventEnvelope } from './create.js';
import { writeTombstone } from './order.js';
import type { OtaPayload } from './payload.js';
import type { OtaScope } from './scope.js';
import type { OtaInboxDeps } from './types.js';

type Tx = Prisma.TransactionClient;

export interface CancelledBooking {
  readonly id: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly roomCount: number;
  readonly channelPolicyCode: string | null;
}

export interface CancelInput {
  readonly deps: OtaInboxDeps;
  readonly scope: OtaScope;
  readonly payload: OtaPayload;
  readonly envelope: EventEnvelope;
  readonly booking: CancelledBooking | null;
  readonly now: Date;
}

export async function applyCancellation(tx: Tx, input: CancelInput): Promise<string | null> {
  const { scope, payload, envelope, now } = input;
  if (input.booking === null) {
    await writeTombstone(tx, {
      channelId: scope.channelId,
      accountKey: envelope.accountId,
      providerBookingCode: payload.providerBookingCode,
      providerUpdatedAt: new Date(payload.providerUpdatedAt),
      cancelledAt: now,
      bookingId: null,
      now,
    });
    return null;
  }
  const booking = input.booking;
  const policyCode = booking.channelPolicyCode ?? 'OTA_CHANNEL';
  await tx.$executeRaw`
    UPDATE bookings
       SET status = 'CANCELLED', cancelled_at = ${now}, cancel_reason = 'OTA_CANCELLATION',
           channel_policy_code = ${policyCode}, updated_at = ${now}
     WHERE id = ${booking.id}::uuid AND status <> 'CANCELLED'`;
  await tx.$executeRaw`
    UPDATE booking_rooms
       SET status = 'CANCELLED', cancelled_at = ${now}, updated_at = ${now}
     WHERE booking_id = ${booking.id}::uuid AND status = 'ACTIVE'`;
  await tx.$executeRaw`
    UPDATE room_assignments
       SET released_at = ${now}, release_reason = 'OTA_CANCELLATION', updated_at = ${now}
     WHERE released_at IS NULL
       AND booking_room_id IN (SELECT id FROM booking_rooms WHERE booking_id = ${booking.id}::uuid)`;
  // Sổ cái là nguồn duy nhất: huỷ chỉ hạch toán lại, không tạo khoản chi/hoàn nào (AC8).
  await new BookingLedger(input.deps.clock).sync(tx, booking.id, systemActor(envelope.eventId));
  await tx.booking_status_history.create({
    data: {
      booking_id: booking.id,
      from_status: 'CONFIRMED',
      to_status: 'CANCELLED',
      reason: 'OTA_CANCELLATION',
      actor_id: null,
      at: now,
    },
  });
  await input.deps.audit.record(tx, {
    actor: systemActor(envelope.eventId),
    action: OTA_CANCELLED_ACTION,
    entityType: 'Booking',
    entityId: booking.id,
    beforeJson: { propertyId: scope.propertyId, status: 'CONFIRMED' },
    afterJson: {
      cancelReason: 'OTA_CANCELLATION',
      channelPolicyCode: policyCode,
      providerBookingCode: payload.providerBookingCode,
      propertyId: scope.propertyId,
    },
    reason: null,
  });
  await tx.outbox_events.create({
    data: {
      event_type: 'InventoryChanged',
      aggregate_type: 'Booking',
      aggregate_id: booking.id,
      payload_json: {
        propertyId: scope.propertyId,
        roomTypeId: scope.roomTypeId,
        startDate: booking.checkIn,
        endDate: booking.checkOut,
        operation: 'BOOKING_CANCELLED',
      },
    },
  });
  return booking.id;
}
