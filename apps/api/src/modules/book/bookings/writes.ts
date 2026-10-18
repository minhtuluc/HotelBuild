/**
 * Các ghi atom của `POST /bookings` (AC1) và `POST /bookings/{bookingId}/confirm` (AC3) — **chỉ** chạy
 * trong transaction do `IdempotencyStore` (HB-029) mở, cùng chỗ với kết quả idempotency:
 *
 * - tạo booking: `bookings` (HELD, hoặc PENDING_PAYMENT với kênh `holdMinutes = 0` — BR-BOOK-07) +
 *   `booking_rooms` (mỗi đơn vị bán một dòng) + `room_assignments` (khoảng nửa mở `[checkIn, checkOut)`)
 *   + `price_snapshots` ORIGINAL (seq 1, BR-RATE-16) + `booking_charges` ROOM + `booking_status_history`
 *   + audit + outbox;
 * - xác nhận: `bookings` → `CONFIRMED` (giữ nguyên assignment, BR-BOOK-09) + `booking_status_history`
 *   + audit.
 *
 * Không tính giá ở đây: `total_amount`/`deposit_amount` lấy **nguyên** từ quote đã tiêu thụ (HB-074,
 * BR-RATE-17); phần bất biến hoá bằng `price_snapshots` nằm ở `snapshot.ts`.
 */
import type { Prisma as PrismaTypes } from '@prisma/client';
import type { Quote } from '@pinehill/contracts';
import type { UnitIdentity } from '@pinehill/domain/inventory';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { bookingCode } from '../holds/writes.js';
import type { BookingCaller } from './principal.js';
import type { SnapshotPlan, SnapshotSource } from './snapshot.js';
import { planSnapshot, snapshotPayload } from './snapshot.js';
import type { BookingInput } from './validation.js';

type Tx = PrismaTypes.TransactionClient;

/**
 * Chia `total` người cho `units` đơn vị bán. `booking_rooms.adults` có ràng buộc `> 0` nên phần người
 * lớn luôn ≥ 1; `children` được phép 0 nên chia đều phần dư. Cùng luật với `insertHold` (HB-076) —
 * chép lại vì `spread` của module đó không xuất ra ngoài phạm vi `book/holds/**`.
 */
function spread(total: number, units: number): number[] {
  const base = Math.floor(total / units);
  const extra = total % units;
  return Array.from({ length: units }, (_, index) => base + (index < extra ? 1 : 0));
}

export interface BookingCreation {
  readonly input: BookingInput;
  readonly caller: BookingCaller;
  readonly quote: Quote;
  readonly quoteId: string;
  readonly quoteFingerprint: string;
  /** `HELD` khi kênh có hạn giữ chỗ, `PENDING_PAYMENT` khi `holdMinutes = 0` (BR-BOOK-07). */
  readonly status: 'HELD' | 'PENDING_PAYMENT';
  /** Hạn giữ chỗ theo giờ CSDL (BR-BOOK-07); `PENDING_PAYMENT` có hạn nên `ck_bookings_hold` thoả. */
  readonly holdExpiresAt: Date;
  readonly ratePlanId: string;
  readonly channelId: string;
  readonly guestId: string;
  readonly units: readonly UnitIdentity[];
  readonly snapshotSource: SnapshotSource;
  /** Giờ CSDL đọc sau khoá (ADR-014) — dùng cho `captured_at`/`updated_at`/`at`. */
  readonly now: Date;
}

export interface WrittenBooking {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly holdExpiresAt: Date;
}

/**
 * AC1: `price_snapshots` ORIGINAL seq 1 (`quote_id` UNIQUE ⇒ một quote một booking) và các dòng
 * `booking_charges.kind = 'ROOM'` (mỗi đơn vị bán × đêm) — phần bất biến hoá cùng booking (BR-RATE-16).
 */
async function insertSnapshotAndCharges(
  tx: Tx,
  bookingId: string,
  creation: BookingCreation,
  plan: SnapshotPlan,
  roomIds: readonly string[],
  now: Date,
): Promise<void> {
  await tx.price_snapshots.create({
    data: {
      booking_id: bookingId,
      seq: 1,
      kind: 'ORIGINAL',
      quote_id: creation.quoteId,
      quote_fingerprint: creation.quoteFingerprint,
      payload_json: snapshotPayload(creation.snapshotSource, plan, roomIds),
      policy_snapshot_json: {
        ...creation.snapshotSource.policy,
        tiers: creation.snapshotSource.policy.tiers.map((tier) => ({ ...tier })),
      },
      gross_amount: plan.grossAmount,
      commission_amount: plan.commissionAmount,
      engine_version: creation.quote.engineVersion,
      channel_property_setting_id: plan.channelPropertySettingId,
      captured_at: now,
      created_at: now,
      updated_at: now,
    },
  });
  const charges = plan.rooms.flatMap((room, index) =>
    room.nights.map((night) => ({
      booking_id: bookingId,
      booking_room_id: roomIds[index]!,
      stay_date: new Date(`${night.date}T00:00:00.000Z`),
      kind: 'ROOM',
      source_key: `ROOM:${roomIds[index]}:${night.date}`,
      amount: night.grossAmount,
      created_at: now,
      updated_at: now,
    })),
  );
  if (charges.length > 0) await tx.booking_charges.createMany({ data: charges });
}

export async function insertBooking(
  tx: Tx,
  audit: AuditWriter,
  creation: BookingCreation,
): Promise<WrittenBooking> {
  const { input, quote, now } = creation;
  const plan: SnapshotPlan = planSnapshot(creation.snapshotSource);
  const { seq } = (
    await tx.$queryRaw<{ seq: bigint }[]>`SELECT nextval('bookings_seq') AS seq`
  )[0]!;
  const booking = await tx.bookings.create({
    data: {
      code: bookingCode(seq, now),
      seq,
      guest_id: creation.guestId,
      property_id: input.propertyId,
      room_type_id: input.roomTypeId,
      rate_plan_id: creation.ratePlanId,
      channel_id: creation.channelId,
      check_in: new Date(`${input.checkIn}T00:00:00.000Z`),
      check_out: new Date(`${input.checkOut}T00:00:00.000Z`),
      adults: input.adults,
      children: input.children,
      status: creation.status,
      room_count: input.roomCount,
      total_amount: BigInt(quote.total),
      deposit_percent: quote.depositPercent,
      deposit_amount: BigInt(quote.depositAmount),
      // BR-PAY-02: nghĩa vụ ban đầu = tổng tiền phòng (chưa có khoản thu nào); cùng transaction với
      // các dòng `booking_charges` ROOM bên dưới nên sổ cái luôn khớp.
      balance_due: BigInt(quote.total),
      currency: 'VND',
      hold_expires_at: creation.holdExpiresAt,
      note: input.note,
      created_by: creation.caller.type === 'USER' ? creation.caller.id : null,
      created_at: now,
      updated_at: now,
    },
    select: { id: true, code: true, status: true, created_at: true },
  });
  const adults = spread(input.adults, input.roomCount);
  const children = spread(input.children, input.roomCount);
  const roomIds: string[] = [];
  for (const [index, unit] of creation.units.entries()) {
    const room = await tx.booking_rooms.create({
      data: {
        booking_id: booking.id,
        room_type_id: input.roomTypeId,
        adults: Math.max(1, adults[index] ?? 1),
        children: children[index] ?? 0,
        price_per_night: plan.rooms[index]?.pricePerNight ?? 0n,
      },
      select: { id: true },
    });
    roomIds.push(room.id);
    await tx.room_assignments.create({
      data: {
        booking_room_id: room.id,
        room_id: unit.roomId,
        bed_no: unit.bedNo,
        start_date: new Date(`${input.checkIn}T00:00:00.000Z`),
        end_date: new Date(`${input.checkOut}T00:00:00.000Z`),
      },
    });
  }
  // AC1: snapshot ORIGINAL cùng transaction với booking — bằng chứng giá/policy bất biến (BR-RATE-16).
  await insertSnapshotAndCharges(tx, booking.id, creation, plan, roomIds, now);
  await tx.booking_status_history.create({
    data: {
      booking_id: booking.id,
      from_status: 'DRAFT',
      to_status: creation.status,
      reason: 'BOOKING_CREATED',
      actor_id: creation.caller.type === 'USER' ? creation.caller.id : null,
      at: now,
    },
  });
  await audit.record(tx, {
    actor: {
      id: creation.caller.type === 'USER' ? creation.caller.id : null,
      role: creation.caller.role,
      ip: creation.caller.ip,
      correlationId: creation.caller.correlationId,
    },
    action: 'BOOKING_CREATED',
    entityType: 'Booking',
    entityId: booking.id,
    beforeJson: null,
    afterJson: {
      propertyId: input.propertyId,
      roomTypeId: input.roomTypeId,
      channelCode: input.channelCode,
      quoteId: creation.quoteId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      roomCount: input.roomCount,
      status: creation.status,
      totalAmount: quote.total,
      depositAmount: quote.depositAmount,
      holdExpiresAt: creation.holdExpiresAt.toISOString(),
    },
    // Ghi chú là văn bản tự do của người gọi ⇒ che số điện thoại/email trước khi vào nhật ký (BR-GEN-07).
    reason: input.note === null ? null : maskOperationalText(input.note),
  });
  await tx.outbox_events.create({
    data: {
      event_type: 'InventoryChanged',
      aggregate_type: 'Booking',
      aggregate_id: booking.id,
      payload_json: {
        propertyId: input.propertyId,
        roomTypeId: input.roomTypeId,
        startDate: input.checkIn,
        endDate: input.checkOut,
        roomIds: creation.units.map((unit) => unit.roomId),
        operation: 'BOOKING_CREATED',
      },
    },
  });
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status,
    createdAt: booking.created_at,
    holdExpiresAt: creation.holdExpiresAt,
  };
}

export interface DuplicateFlag {
  readonly bookingId: string;
  readonly propertyId: string;
  readonly caller: BookingCaller;
}

/**
 * BR-BOOK-16: đánh dấu hàng **đã có** là nghi trùng (cột `duplicate_suspected` + vết kiểm toán) rồi trả
 * chính booking đó cho người gọi, không tạo bản ghi mới. Không đổi trạng thái/tiền của booking cũ.
 * Mốc thời gian là **giờ CSDL** (BR-BOOK-18), không phải giờ tiến trình.
 */
export async function flagDuplicateSuspected(
  tx: Tx,
  audit: AuditWriter,
  flag: DuplicateFlag,
): Promise<void> {
  const before = await tx.bookings.findUniqueOrThrow({
    where: { id: flag.bookingId },
    select: { duplicate_suspected: true },
  });
  if (before.duplicate_suspected) return;
  const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
  await tx.bookings.update({
    where: { id: flag.bookingId },
    data: { duplicate_suspected: true, updated_at: now },
  });
  await audit.record(tx, {
    actor: {
      id: flag.caller.type === 'USER' ? flag.caller.id : null,
      role: flag.caller.role,
      ip: flag.caller.ip,
      correlationId: flag.caller.correlationId,
    },
    action: 'BOOKING_DUPLICATE_SUSPECTED',
    entityType: 'Booking',
    entityId: flag.bookingId,
    beforeJson: { propertyId: flag.propertyId, duplicateSuspected: false },
    afterJson: { propertyId: flag.propertyId, duplicateSuspected: true },
    reason: 'Trùng kênh/SĐT/loại phòng/ngày nhận phòng trong 24 giờ (BR-BOOK-16).',
  });
}

export interface BookingConfirmation {
  readonly bookingId: string;
  readonly propertyId: string;
  readonly fromStatus: 'HELD' | 'PENDING_PAYMENT';
  readonly paymentId: string;
  readonly paidAmount: bigint;
  readonly caller: BookingCaller;
  /** Giờ CSDL đọc sau khoá (BR-BOOK-18). */
  readonly now: Date;
}

/**
 * BR-BOOK-09: xác nhận = khoá booking → kiểm hạn/tiền đã thu → `CONFIRMED`, **giữ nguyên** assignment
 * (không tạo assignment thứ hai), ghi history + audit trong cùng transaction. Không xoá
 * `hold_expires_at`: giữ lại mốc hạn của cam kết cũ làm bằng chứng; job hết hạn (HB-078) chỉ quét
 * `HELD`/`PENDING_PAYMENT` nên booking đã xác nhận không bị đụng.
 */
export async function confirmBooking(
  tx: Tx,
  audit: AuditWriter,
  confirmation: BookingConfirmation,
): Promise<void> {
  await tx.bookings.update({
    where: { id: confirmation.bookingId },
    data: {
      status: 'CONFIRMED',
      updated_at: confirmation.now,
      version: { increment: 1 },
    },
  });
  await tx.booking_status_history.create({
    data: {
      booking_id: confirmation.bookingId,
      from_status: confirmation.fromStatus,
      to_status: 'CONFIRMED',
      reason: 'CONFIRMED',
      actor_id: confirmation.caller.type === 'USER' ? confirmation.caller.id : null,
      at: confirmation.now,
    },
  });
  await audit.record(tx, {
    actor: {
      id: confirmation.caller.type === 'USER' ? confirmation.caller.id : null,
      role: confirmation.caller.role,
      ip: confirmation.caller.ip,
      correlationId: confirmation.caller.correlationId,
    },
    action: 'BOOKING_CONFIRMED',
    entityType: 'Booking',
    entityId: confirmation.bookingId,
    beforeJson: { propertyId: confirmation.propertyId, status: confirmation.fromStatus },
    afterJson: {
      propertyId: confirmation.propertyId,
      status: 'CONFIRMED',
      paymentId: confirmation.paymentId,
      paidAmount: confirmation.paidAmount.toString(),
    },
    reason: null,
  });
}
