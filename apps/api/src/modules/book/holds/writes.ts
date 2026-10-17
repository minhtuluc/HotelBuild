/**
 * Các ghi atom của `POST /holds` (AC3) và `DELETE /holds/{holdId}` (AC4) — **chỉ** chạy trong
 * transaction do `IdempotencyStore` (HB-029) mở, cùng chỗ với kết quả idempotency:
 *
 * - tạo hold: `bookings` (HELD) + `booking_rooms` (mỗi đơn vị bán một dòng) + `room_assignments`
 *   (khoảng nửa mở `[checkIn, checkOut)`) + `booking_status_history` + audit + outbox;
 * - giải phóng: nhả mọi `room_assignments` còn hoạt động + booking → `CANCELLED` + history + audit +
 *   outbox (BR-INV-04, BR-BOOK-11).
 *
 * Không tính giá ở đây: `total_amount`/`deposit_amount` lấy **nguyên** từ quote đã tiêu thụ (HB-074,
 * BR-RATE-17). `price_per_night` là đơn giá phòng-đêm của đơn vị bán suy từ tổng kỳ (giá từng đêm nằm
 * trong quote; HB-077 mới là nơi chốt bất biến bằng `price_snapshots`).
 */
import type { Prisma as PrismaTypes } from '@prisma/client';
import type { Quote } from '@pinehill/contracts';
import type { AvailabilityInput, UnitIdentity } from '@pinehill/domain/inventory';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import type { HoldCaller } from './principal.js';
import type { HoldInput } from './validation.js';
import { invalidState } from './validation.js';

type Tx = PrismaTypes.TransactionClient;

/** BR-GEN-06: mã `PH-<YYMMDD>-<5 ký tự A-Z0-9>`, sinh từ `bookings.seq` nên duy nhất kể cả cùng mili-giây. */
export function bookingCode(seq: bigint, now: Date): string {
  const stamp = now.toISOString().slice(2, 10).replaceAll('-', '');
  const encoded = seq.toString(36).toUpperCase();
  // 36^5 = 60.466.176 mã: vượt ngưỡng thì hợp đồng mã không còn biểu diễn được (BR-GEN-06).
  if (seq <= 0n || encoded.length > 5) throw new Error('Booking sequence exhausted');
  return `PH-${stamp}-${encoded.padStart(5, '0')}`;
}

/**
 * Chia `total` người cho `rooms` đơn vị bán. `booking_rooms.adults` có ràng buộc `> 0` nên phần người
 * lớn luôn ≥ 1; `children` được phép 0 nên chia đều phần dư.
 */
function spread(total: number, rooms: number): number[] {
  const base = Math.floor(total / rooms);
  const extra = total % rooms;
  return Array.from({ length: rooms }, (_, index) => base + (index < extra ? 1 : 0));
}

export interface HoldCreation {
  readonly input: HoldInput;
  readonly caller: HoldCaller;
  readonly quote: Quote;
  readonly ratePlanId: string;
  readonly channelId: string;
  readonly units: readonly UnitIdentity[];
  /** Dữ kiện đã đọc sau khoá; `now` là giờ CSDL (BR-BOOK-07). */
  readonly facts: AvailabilityInput;
  readonly holdMinutes: number;
  readonly ip: string | null;
  readonly correlationId: string;
}

export async function insertHold(
  tx: Tx,
  audit: AuditWriter,
  creation: HoldCreation,
): Promise<{ id: string; code: string; createdAt: Date; holdExpiresAt: Date }> {
  const now = creation.facts.now;
  const holdExpiresAt = new Date(now.getTime() + creation.holdMinutes * 60_000);
  const start = new Date(`${creation.input.checkIn}T00:00:00.000Z`);
  const end = new Date(`${creation.input.checkOut}T00:00:00.000Z`);
  const nights = creation.quote.nights.length;
  const rooms = creation.input.roomCount;
  const { seq } = (
    await tx.$queryRaw<{ seq: bigint }[]>`SELECT nextval('bookings_seq') AS seq`
  )[0]!;
  const booking = await tx.bookings.create({
    data: {
      code: bookingCode(seq, now),
      seq,
      guest_id: creation.caller.id,
      property_id: creation.input.propertyId,
      room_type_id: creation.input.roomTypeId,
      rate_plan_id: creation.ratePlanId,
      channel_id: creation.channelId,
      check_in: start,
      check_out: end,
      adults: creation.input.adults,
      children: creation.input.children,
      status: 'HELD',
      room_count: rooms,
      total_amount: BigInt(creation.quote.total),
      deposit_percent: creation.quote.depositPercent,
      deposit_amount: BigInt(creation.quote.depositAmount),
      balance_due: BigInt(creation.quote.total),
      currency: 'VND',
      hold_expires_at: holdExpiresAt,
      created_by: creation.caller.type === 'USER' ? creation.caller.id : null,
    },
    select: { id: true, code: true, created_at: true },
  });
  const pricePerNight = BigInt(Math.floor(creation.quote.total / Math.max(nights, 1)));
  const adults = spread(creation.input.adults, rooms);
  const children = spread(creation.input.children, rooms);
  for (const [index, unit] of creation.units.entries()) {
    const room = await tx.booking_rooms.create({
      data: {
        booking_id: booking.id,
        room_type_id: creation.input.roomTypeId,
        adults: Math.max(1, adults[index] ?? 1),
        children: children[index] ?? 0,
        price_per_night: pricePerNight,
      },
      select: { id: true },
    });
    await tx.room_assignments.create({
      data: {
        booking_room_id: room.id,
        room_id: unit.roomId,
        bed_no: unit.bedNo,
        start_date: start,
        end_date: end,
      },
    });
  }
  await tx.booking_status_history.create({
    data: {
      booking_id: booking.id,
      from_status: 'DRAFT',
      to_status: 'HELD',
      reason: 'HOLD_CREATED',
      actor_id: creation.caller.type === 'USER' ? creation.caller.id : null,
      at: now,
    },
  });
  await audit.record(tx, {
    actor: {
      id: creation.caller.type === 'USER' ? creation.caller.id : null,
      role: creation.caller.role,
      ip: creation.ip,
      correlationId: creation.correlationId,
    },
    action: 'HOLD_CREATED',
    entityType: 'Booking',
    entityId: booking.id,
    beforeJson: null,
    afterJson: {
      propertyId: creation.input.propertyId,
      roomTypeId: creation.input.roomTypeId,
      channelCode: creation.input.channelCode,
      checkIn: creation.input.checkIn,
      checkOut: creation.input.checkOut,
      roomCount: rooms,
      status: 'HELD',
      holdExpiresAt: holdExpiresAt.toISOString(),
    },
    reason: null,
  });
  await tx.outbox_events.create({
    data: {
      event_type: 'InventoryChanged',
      aggregate_type: 'Booking',
      aggregate_id: booking.id,
      payload_json: {
        propertyId: creation.input.propertyId,
        roomTypeId: creation.input.roomTypeId,
        startDate: creation.input.checkIn,
        endDate: creation.input.checkOut,
        roomIds: creation.units.map((unit) => unit.roomId),
        operation: 'HOLD_CREATED',
      },
    },
  });
  return { id: booking.id, code: booking.code, createdAt: booking.created_at, holdExpiresAt };
}

export interface HoldRelease {
  readonly bookingId: string;
  readonly propertyId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly roomTypeId: string;
  readonly reason: string;
  readonly caller: HoldCaller;
  /** Giờ CSDL đọc sau khoá (ADR-014). */
  readonly now: Date;
  readonly ip: string | null;
  readonly correlationId: string;
}

export async function releaseHold(
  tx: Tx,
  audit: AuditWriter,
  release: HoldRelease,
): Promise<number> {
  const held = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM room_assignments
    WHERE released_at IS NULL
      AND booking_room_id IN (SELECT id FROM booking_rooms WHERE booking_id = ${release.bookingId}::uuid)
    ORDER BY id FOR UPDATE`;
  if (held.length > 0)
    await tx.room_assignments.updateMany({
      where: { id: { in: held.map((row) => row.id) } },
      data: { released_at: release.now, release_reason: 'HOLD_RELEASED', updated_at: release.now },
    });
  const cancelReason = release.caller.type === 'GUEST' ? 'GUEST_REQUEST' : 'SYSTEM';
  await tx.bookings.update({
    where: { id: release.bookingId },
    data: {
      status: 'CANCELLED',
      cancelled_at: release.now,
      cancel_reason: cancelReason,
      updated_at: release.now,
      version: { increment: 1 },
    },
  });
  await tx.booking_status_history.create({
    data: {
      booking_id: release.bookingId,
      from_status: 'HELD',
      to_status: 'CANCELLED',
      reason: 'HOLD_RELEASED',
      actor_id: release.caller.type === 'USER' ? release.caller.id : null,
      at: release.now,
    },
  });
  await audit.record(tx, {
    actor: {
      id: release.caller.type === 'USER' ? release.caller.id : null,
      role: release.caller.role,
      ip: release.ip,
      correlationId: release.correlationId,
    },
    action: 'HOLD_RELEASED',
    entityType: 'Booking',
    entityId: release.bookingId,
    beforeJson: {
      propertyId: release.propertyId,
      status: 'HELD',
      releasedAssignments: held.length,
    },
    afterJson: {
      propertyId: release.propertyId,
      status: 'CANCELLED',
      cancelReason,
      releasedAssignments: held.length,
    },
    // Lý do là văn bản tự do của người gọi ⇒ che số điện thoại/email trước khi vào nhật ký (BR-GEN-07).
    reason: maskOperationalText(release.reason),
  });
  await tx.outbox_events.create({
    data: {
      event_type: 'InventoryChanged',
      aggregate_type: 'Booking',
      aggregate_id: release.bookingId,
      payload_json: {
        propertyId: release.propertyId,
        roomTypeId: release.roomTypeId,
        startDate: release.checkIn,
        endDate: release.checkOut,
        operation: 'HOLD_RELEASED',
      },
    },
  });
  return held.length;
}

/** Lệnh giải phóng chỉ áp cho hold còn hiệu lực (BR-BOOK-06/18); trạng thái khác là lệnh sai. */
export function assertReleasable(status: string, holdExpiresAt: Date | null, now: Date): void {
  if (status !== 'HELD') throw invalidState('Chỉ giải phóng được hold đang ở trạng thái HELD.');
  if (holdExpiresAt === null || holdExpiresAt.getTime() <= now.getTime())
    throw invalidState('Hold đã hết hạn; phòng đã trở về tồn khả dụng.');
}
