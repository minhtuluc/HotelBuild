/**
 * Các ghi nguyên tử của hai lệnh HB-098, tất cả trong transaction mà `IdempotencyStore` (HB-029) mở
 * (BR-BOOK-12 "thay lịch + assignment + total + snapshot + rescheduleCount + audit/outbox nguyên tử"):
 *
 * - **đổi ngày**: nhả `room_assignments` cũ → ghi đơn vị bán mới của kỳ mới → `bookings.check_in/out`,
 *   `total_amount = max(total cũ, giá kỳ mới)` (BR-BOOK-12), `reschedule_count + 1` **kèm guard
 *   `version`** → `booking_rooms.price_per_night` theo ảnh giá mới → `price_snapshots` RESCHEDULE
 *   **giữ nguyên** bản ORIGINAL (ADR-015 §7, BR-RATE-16) → nghĩa vụ tăng thêm + phí đổi → đồng bộ sổ
 *   (`BookingLedger.sync`, BR-PAY-02) → audit → outbox. **Không** tạo `RefundRequest` khi giá giảm
 *   (BR-CANCEL-08): phần giảm chỉ được ghi bằng phần "giữ lại" trong ảnh giá mới.
 * - **xoá cứng**: chỉ `DRAFT`/`HELD` **chưa** có khoản thanh toán nào (BR-BOOK-14), nhả assignment rồi
 *   xoá; `AuditLog.beforeJson` do trigger `trg_bookings_delete` ghi **trước** khi xoá (BR-BOOK-17) nên
 *   `app.delete_reason`/`app.actor_*` phải được đặt trong chính transaction này.
 */
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { DomainError } from '@pinehill/domain';
import type { UnitIdentity } from '@pinehill/domain/inventory';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { RetryTransaction } from '../../../common/idempotency/transaction-retry.js';
import { LedgerError } from '../../pay/ledger/projection.js';
import type { JsonRecord } from '../cancel/context.js';
import { allocate, snapshotPayload } from '../bookings/snapshot.js';
import type { SnapshotPlan, SnapshotSource } from '../bookings/snapshot.js';
import type { RescheduleRoom } from './context.js';
import { hardDeleteForbidden, missing, notAllowed, stale } from './validation.js';

export type Tx = PrismaTypes.TransactionClient;

/** Số tiền vào JSON nhật ký/ảnh giá là số (hợp đồng đã phát hành); chặn ngoài dải an toàn. */
export function safeAmount(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw notAllowed('Số tiền vượt giới hạn an toàn của hợp đồng.');
  return Number(value);
}

function retryable(error: Prisma.PrismaClientKnownRequestError): boolean {
  return (
    error.code === 'P2034' ||
    (error.code === 'P2010' && ['55P03', '40P01', '40001'].includes(String(error.meta?.code)))
  );
}

/** Ràng buộc loại trừ BR-INV-03 (hai đơn vị bán trùng đêm) sau khi ghi assignment kỳ mới. */
function exclusion(error: Prisma.PrismaClientKnownRequestError): boolean {
  return (
    (error.code === 'P2010' && error.meta?.code === '23P01') ||
    (error.code === 'P2004' && String(error.meta?.database_error).includes('23P01'))
  );
}

/**
 * Ánh xạ lỗi CSDL/sổ tiền của lệnh đổi ngày sang mã catalogue — không tự chế mã, không nuốt lỗi:
 * đua tranh ⇒ `RetryTransaction` (chạy lại **toàn bộ** transaction), trùng lịch ⇒ `409 E_INV_ROOM_TAKEN`,
 * còn lại ⇒ `409 E_BOOK_INVALID_STATE` (dữ liệu đã đổi dưới chân lệnh).
 */
export function safeError(error: unknown): never {
  if (error instanceof AppError || error instanceof RetryTransaction) throw error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (retryable(error))
      throw new RetryTransaction(
        new AppError(409, 'E_SYS_REQUEST_IN_PROGRESS', 'Đặt phòng đang được cập nhật.', 1),
      );
    if (exclusion(error)) throw new AppError(409, 'E_INV_ROOM_TAKEN', 'Lịch phòng đã thay đổi.');
    throw notAllowed('Dữ liệu đổi ngày đã thay đổi; hãy tải lại và thử lại.');
  }
  if (error instanceof LedgerError)
    throw notAllowed('Sổ tiền của đặt phòng không cho phép đổi ngày theo yêu cầu này.');
  if (error instanceof DomainError)
    throw notAllowed('Không thể tính tiền đổi ngày cho đặt phòng này.');
  throw error;
}

/** BR-BOOK-14/BR-BOOK-11: nhả mọi `RoomAssignment` đang hoạt động của booking trong cùng transaction. */
export async function releaseAssignments(
  tx: Tx,
  bookingRoomIds: readonly string[],
  reason: string,
  now: Date,
): Promise<number> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM room_assignments
     WHERE booking_room_id = ANY(${[...bookingRoomIds]}::uuid[]) AND released_at IS NULL
     ORDER BY id FOR UPDATE`;
  if (!rows.length) return 0;
  await tx.room_assignments.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: { released_at: now, release_reason: reason, updated_at: now },
  });
  return rows.length;
}

/** Đơn vị bán của kỳ mới theo **thứ tự** `booking_rooms.id` (BR-BOOK-10: một đơn vị một dòng). */
export async function insertAssignments(
  tx: Tx,
  roomIds: readonly string[],
  units: readonly UnitIdentity[],
  checkIn: string,
  checkOut: string,
  now: Date,
): Promise<void> {
  for (const [index, unit] of units.entries()) {
    const bookingRoomId = roomIds[index];
    if (bookingRoomId === undefined)
      throw notAllowed('Số đơn vị bán mới vượt số phòng của booking.');
    await tx.room_assignments.create({
      data: {
        booking_room_id: bookingRoomId,
        room_id: unit.roomId,
        bed_no: unit.bedNo,
        start_date: new Date(`${checkIn}T00:00:00.000Z`),
        end_date: new Date(`${checkOut}T00:00:00.000Z`),
        created_at: now,
        updated_at: now,
      },
    });
  }
}

export interface WindowMove {
  readonly bookingId: string;
  readonly expectedVersion: bigint;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly totalAmount: bigint;
  readonly now: Date;
}

/**
 * Đổi kỳ ở lại và tăng `reschedule_count`. `WHERE version = :expected` là guard hai lớp cùng hàng
 * `FOR UPDATE` (api.md §1.3): 0 dòng ⇒ `412 E_GEN_VERSION_CONFLICT` (trigger `trg_version` tự tăng).
 */
export async function moveWindow(
  tx: Tx,
  move: WindowMove,
): Promise<{ readonly count: number; readonly version: bigint }> {
  const rows = await tx.$queryRaw<{ reschedule_count: number; version: bigint }[]>`
    UPDATE bookings SET
      check_in = ${move.checkIn}::date,
      check_out = ${move.checkOut}::date,
      total_amount = ${move.totalAmount},
      reschedule_count = reschedule_count + 1,
      updated_at = ${move.now}::timestamptz
     WHERE id = ${move.bookingId}::uuid AND version = ${move.expectedVersion}
    RETURNING reschedule_count, version`;
  const row = rows[0];
  if (row === undefined) throw stale();
  return { count: row.reschedule_count, version: row.version };
}

/** `price_per_night` của từng đơn vị bán theo ảnh giá **mới** (HB-098 AC: giá kỳ mới vào booking_rooms). */
export async function priceRooms(
  tx: Tx,
  rooms: readonly RescheduleRoom[],
  plan: SnapshotPlan,
  now: Date,
): Promise<void> {
  for (const [index, room] of rooms.entries()) {
    const price = plan.rooms[index]?.pricePerNight;
    if (price === undefined) throw notAllowed('Ảnh giá mới thiếu đơn giá cho đơn vị bán.');
    await tx.booking_rooms.update({
      where: { id: room.id },
      data: { price_per_night: price, updated_at: now },
    });
  }
}

export interface RescheduleSnapshot {
  readonly bookingId: string;
  readonly sequence: number;
  readonly source: SnapshotSource;
  readonly plan: SnapshotPlan;
  readonly roomIds: readonly string[];
  readonly policyJson: JsonRecord;
  readonly previous: {
    readonly checkIn: string;
    readonly checkOut: string;
    readonly totalAmount: bigint;
    readonly rescheduleCount: number;
  };
  readonly increase: bigint;
  readonly retained: bigint;
  readonly fee: bigint;
  readonly reason: string;
  readonly now: Date;
}

/**
 * BR-RATE-16/ADR-015 §7: **thêm** một bản `kind = RESCHEDULE` (`seq + 1`), không sửa bản ORIGINAL
 * (cột `quote_id`/`quote_fingerprint` để trống — `ck_snapshot_quote` chỉ cho ORIGINAL giữ quote; bản
 * mới mang quoteId/fingerprint của báo giá kỳ mới **trong** `payload_json`). Payload ghi rõ policy hợp
 * đồng gốc đã giữ, giá kỳ mới, phí đổi và **phần chênh lệch giữ lại** khi giá giảm.
 */
export async function appendRescheduleSnapshot(
  tx: Tx,
  snapshot: RescheduleSnapshot,
): Promise<void> {
  const payload: PrismaTypes.InputJsonObject = {
    ...snapshotPayload(snapshot.source, snapshot.plan, snapshot.roomIds),
    reschedule: {
      previousCheckIn: snapshot.previous.checkIn,
      previousCheckOut: snapshot.previous.checkOut,
      previousTotalAmount: safeAmount(snapshot.previous.totalAmount),
      previousRescheduleCount: snapshot.previous.rescheduleCount,
      offeredTotal: snapshot.source.quote.total,
      balanceIncrease: safeAmount(snapshot.increase),
      retainedAmount: safeAmount(snapshot.retained),
      feeAmount: safeAmount(snapshot.fee),
      rescheduleCount: snapshot.previous.rescheduleCount + 1,
      reason: snapshot.reason,
    },
  };
  await tx.price_snapshots.create({
    data: {
      booking_id: snapshot.bookingId,
      seq: snapshot.sequence,
      kind: 'RESCHEDULE',
      quote_id: null,
      quote_fingerprint: null,
      payload_json: payload,
      policy_snapshot_json: snapshot.policyJson,
      gross_amount: snapshot.plan.grossAmount,
      commission_amount: snapshot.plan.commissionAmount,
      engine_version: snapshot.source.quote.engineVersion,
      channel_property_setting_id: snapshot.plan.channelPropertySettingId,
      captured_at: snapshot.now,
      created_at: snapshot.now,
      updated_at: snapshot.now,
    },
  });
}

/**
 * BR-BOOK-12/BR-CANCEL-07: phí đổi ngày = làm tròn **lên** 1.000 của `rescheduleFeePct`% **tổng tiền
 * phòng kỳ cũ** (`FLEX7`/`SAVER3`/`LONGSTAY14` khai `rescheduleFeePct = 0` nên miễn phí lần đầu).
 * `ceil1000` của `@pinehill/domain/pricing` là helper **nội bộ** pipeline giá (không xuất ra package),
 * nên công thức bậc thang viết bằng BigInt nguyên — cùng cách `commissionOf` (HB-077) làm cho hoa hồng.
 */
export function rescheduleFee(percent: number, oldTotal: bigint): bigint {
  if (!(percent > 0)) return 0n;
  const hundredths = BigInt(Math.round(percent * 100));
  const amount = (oldTotal * hundredths + 9_999n) / 10_000n;
  return ((amount + 999n) / 1_000n) * 1_000n;
}

export interface RescheduleCharges {
  readonly bookingId: string;
  readonly roomIds: readonly string[];
  readonly plan: SnapshotPlan;
  /** Chênh lệch **tăng** (BR-BOOK-12: "khoản chênh tăng là tiền phòng (BALANCE)"). */
  readonly increase: bigint;
  readonly fee: bigint;
  readonly rescheduleCount: number;
  readonly reason: string;
  readonly now: Date;
}

/**
 * Nghĩa vụ mới của lệnh đổi ngày, giữ bất biến sổ `Σ(ROOM chưa void) == bookings.total_amount`:
 * phần **tăng** được phân bổ lên chính các ô (đơn vị bán × đêm) của kỳ mới theo trọng số giá đêm của
 * ảnh giá mới (cùng `allocate` của HB-077 nên tổng khớp tuyệt đối), còn `total_amount` khi giá **giảm**
 * không đổi nên không cần dòng nào thêm. Phí đổi là nghĩa vụ **riêng** `kind = RESCHEDULE_FEE`
 * (BR-BOOK-12 "phí đổi thu riêng"); HB-096 chỉ thu tiền và phân bổ lên chính các dòng này.
 */
export async function recordRescheduleCharges(
  tx: Tx,
  charges: RescheduleCharges,
): Promise<{ readonly feeChargeId: string | null }> {
  if (charges.increase > 0n) {
    const cells = charges.plan.rooms.flatMap((room, index) => {
      const roomId = charges.roomIds[index];
      if (roomId === undefined) throw notAllowed('Ảnh giá mới thiếu đơn vị bán.');
      return room.nights.map((night) => ({ roomId, date: night.date, weight: night.grossAmount }));
    });
    const amounts = allocate(
      charges.increase,
      cells.map((cell) => cell.weight),
    );
    const rows = cells.flatMap((cell, index) => {
      const amount = amounts[index]!;
      if (amount <= 0n) return [];
      return [
        {
          booking_id: charges.bookingId,
          booking_room_id: cell.roomId,
          stay_date: new Date(`${cell.date}T00:00:00.000Z`),
          kind: 'ROOM',
          source_key: `ROOM:${cell.roomId}:${cell.date}:R${charges.rescheduleCount}`,
          amount,
          reason: charges.reason,
          created_at: charges.now,
          updated_at: charges.now,
        },
      ];
    });
    if (rows.length > 0) await tx.booking_charges.createMany({ data: rows });
  }
  if (charges.fee <= 0n) return { feeChargeId: null };
  const fee = await tx.booking_charges.create({
    data: {
      booking_id: charges.bookingId,
      kind: 'RESCHEDULE_FEE',
      source_key: `RESCHEDULE_FEE:${charges.rescheduleCount}`,
      amount: charges.fee,
      reason: charges.reason,
      created_at: charges.now,
      updated_at: charges.now,
    },
    select: { id: true },
  });
  return { feeChargeId: fee.id };
}

export interface RescheduleAnnouncement {
  readonly bookingId: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly units: readonly UnitIdentity[];
}

/** BR-CHAN-06/BR-BOOK-12: đồng bộ kênh thấy kỳ lưu trú mới qua outbox cùng transaction. */
export async function announceReschedule(
  tx: Tx,
  announcement: RescheduleAnnouncement,
): Promise<void> {
  await tx.outbox_events.create({
    data: {
      event_type: 'InventoryChanged',
      aggregate_type: 'Booking',
      aggregate_id: announcement.bookingId,
      payload_json: {
        propertyId: announcement.propertyId,
        roomTypeId: announcement.roomTypeId,
        startDate: announcement.checkIn,
        endDate: announcement.checkOut,
        roomIds: announcement.units.map((unit) => unit.roomId),
        operation: 'BOOKING_RESCHEDULED',
      },
    },
  });
}

export interface HardDelete {
  readonly bookingId: string;
  readonly reason: string;
  readonly actor: AuthorizedActor;
}

/**
 * BR-BOOK-14/17: xoá cứng **chỉ** `DRAFT`/`HELD` chưa có khoản thanh toán nào (kể cả PENDING/FAILED —
 * chỉ cần một hàng `payments` là đủ để từ chối), nhả assignment rồi xoá. `app.delete_reason` +
 * `app.actor_*` phải đặt **trong transaction này**: trigger `trg_bookings_delete` ghi `AuditLog`
 * `action = 'DELETE'` với `beforeJson` (booking + mọi ảnh giá) **trước** khi hàng biến mất, và
 * `fn_immutable_record` chỉ cho cascade xoá `price_snapshots` khi đã có vết đó.
 */
export async function hardDeleteBooking(tx: Tx, command: HardDelete): Promise<void> {
  const rows = await tx.$queryRaw<
    { status: string }[]
  >`SELECT status FROM bookings WHERE id = ${command.bookingId}::uuid FOR UPDATE`;
  const booking = rows[0];
  if (booking === undefined) throw missing();
  if (booking.status !== 'DRAFT' && booking.status !== 'HELD')
    throw hardDeleteForbidden(
      'Chỉ xoá cứng được đặt phòng ở DRAFT/HELD; hãy chuyển CANCELLED và lập yêu cầu hoàn (BR-BOOK-14).',
    );
  // "Không có bất kỳ Payment/lần thanh toán nào" — PENDING/FAILED cũng chặn (BR-BOOK-14), kèm lý do
  // "cấm xoá đối tượng có thể nhận callback muộn" nên hồ sơ hoàn còn treo cũng chặn.
  const payments = await tx.payments.count({ where: { booking_id: command.bookingId } });
  if (payments > 0)
    throw hardDeleteForbidden(
      'Đặt phòng đã phát sinh thanh toán nên không xoá cứng được; hãy chuyển CANCELLED (BR-BOOK-14).',
    );
  const refunds = await tx.refund_requests.count({ where: { booking_id: command.bookingId } });
  if (refunds > 0) throw hardDeleteForbidden('Đặt phòng còn hồ sơ hoàn có thể nhận callback muộn.');
  await tx.$executeRaw`SELECT set_config('app.actor_id', ${command.actor.id}, true),
                              set_config('app.actor_role', ${command.actor.role}, true),
                              set_config('app.delete_reason', ${command.reason}, true)`;
  await tx.$executeRaw`
    UPDATE room_assignments SET released_at = now(), release_reason = 'HARD_DELETE',
           updated_at = now()
     WHERE released_at IS NULL AND booking_room_id IN (
       SELECT id FROM booking_rooms WHERE booking_id = ${command.bookingId}::uuid)`;
  // `booking_charges` tham chiếu `bookings` bằng `ON DELETE RESTRICT`: chưa có thanh toán nào nên nghĩa
  // vụ chưa được phân bổ — xoá cùng bản ghi để FK cho phép (phần còn lại cascade theo `bookings`).
  await tx.$executeRaw`DELETE FROM booking_charges WHERE booking_id = ${command.bookingId}::uuid`;
  await tx.$executeRaw`DELETE FROM bookings WHERE id = ${command.bookingId}::uuid`;
}
