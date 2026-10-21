/**
 * Ghi của `POST /front-office/check-in` (HB-144) — **chỉ** trong transaction idempotency.
 *
 * Assignment dùng đúng luật chống trùng của CSDL (ràng buộc loại trừ `excl_room_assignments_no_double_booking`,
 * HB-008): không đọc-rồi-quyết rồi ghi, không chép lại luật tồn phòng. Mã `23P01` được `inventoryError`
 * của F4 đổi thành `409 E_INV_ROOM_TAKEN` (BR-INV-03), không nuốt lỗi.
 *
 * `checkedInAt` không có cột riêng: mốc đọc bằng `clock_timestamp()` **sau khi khoá** (ADR-014) được ghi
 * vào `booking_status_history.at` và trả lại nguyên giá trị trong phản hồi.
 */
import type { Prisma } from '@prisma/client';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import type { LockedBooking } from '../../book/bookings/lock.js';
import { inventoryError } from '../../book/holds/lock.js';
import type { BookingLedger } from '../../pay/ledger/service.js';

type Tx = Prisma.TransactionClient;

export interface Assignment {
  readonly bookingRoomId: string;
  readonly roomId: string;
}

/**
 * Gán phòng thực tế cho từng đơn vị bán. Assignment đã đúng phòng/kỳ thì giữ nguyên (gọi lại không tạo
 * dòng thứ hai); lệch phòng thì giải phóng dòng cũ rồi gán dòng mới — cả hai cùng transaction nên
 * không có khe hở bán lại phòng.
 */
export async function assignActualRooms(
  tx: Tx,
  booking: LockedBooking,
  assignments: readonly Assignment[],
  now: Date,
): Promise<void> {
  for (const { bookingRoomId, roomId } of assignments) {
    const active = await tx.$queryRaw<
      { id: string; room_id: string; start_date: Date; end_date: Date }[]
    >`SELECT id, room_id, start_date, end_date FROM room_assignments
       WHERE booking_room_id = ${bookingRoomId}::uuid AND released_at IS NULL
       ORDER BY id FOR UPDATE`;
    const same = active.find((row) => row.room_id === roomId);
    // `same` đã đúng phòng: kỳ lưu trú là bất biến của booking nên không có gì phải sửa (idempotent).
    if (same !== undefined) continue;
    if (active.length > 0)
      await tx.room_assignments.updateMany({
        where: { id: { in: active.map((row) => row.id) } },
        data: {
          released_at: now,
          release_reason: 'CHECKIN_ROOM_CHANGED',
          updated_at: now,
        },
      });
    await tx.$executeRaw`
      INSERT INTO room_assignments(booking_room_id, room_id, bed_no, start_date, end_date, created_at, updated_at)
      VALUES(${bookingRoomId}::uuid, ${roomId}::uuid, 0, ${booking.checkIn}::date, ${booking.checkOut}::date,
             ${now}::timestamptz, ${now}::timestamptz)`;
  }
}

export interface EarlyFeeWrite {
  readonly bookingId: string;
  readonly checkInDate: string;
  /** Phụ thu VND nguyên do engine HB-141 trả về (`earlyCheckInFee`). */
  readonly amount: number;
}

/**
 * BR-FO-04: phụ thu check-in sớm là **nghĩa vụ** của booking, không chỉ một con số trong phản hồi.
 * Ghi một `booking_charges` `EXTRA_SERVICE` với `source_key` ổn định (một booking một phụ thu ⇒ gọi lại
 * không nhân đôi), rồi để `BookingLedger.sync` chiếu lại `balance_due` — không ghi tay cột số dư
 * (BR-PAY-02, ADR-016).
 */
export async function recordEarlyFee(
  tx: Tx,
  ledger: BookingLedger,
  actor: AuthorizedActor,
  write: EarlyFeeWrite,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO booking_charges(booking_id, stay_date, kind, source_key, amount, reason)
    VALUES(${write.bookingId}::uuid, ${write.checkInDate}::date, 'EXTRA_SERVICE',
           ${`checkin-early:${write.bookingId}`}, ${BigInt(write.amount)}, 'CHECKIN_EARLY')
    ON CONFLICT (booking_id, source_key) DO NOTHING`;
  await ledger.sync(tx, write.bookingId, actor);
}

export interface CheckInWrite {
  readonly booking: LockedBooking;
  readonly assignments: readonly Assignment[];
  readonly roomIds: readonly string[];
  readonly note: string | undefined;
  readonly idNumber: string | undefined;
  readonly earlyCheckInFee: number;
  readonly balanceDue: number;
  /** Số nợ được duyệt (VND nguyên) + hạn thu `check_out` — null khi không ghi nợ. */
  readonly debt: { readonly amount: number; readonly collectionDeadline: string } | null;
}

/**
 * Chuyển booking sang `CHECKED_IN`, ghi lịch sử + nhật ký trong cùng transaction (BR-SYS-01).
 * Trả mốc `clock_timestamp()` đã dùng cho `booking_status_history.at` để phản hồi `checkedInAt`.
 */
export async function writeCheckIn(
  tx: Tx,
  audit: AuditWriter,
  actor: AuthorizedActor,
  write: CheckInWrite,
): Promise<Date> {
  const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
  // `guests.id_number` là cột duy nhất schema cho phép (NFR-SEC-03). Chỉ điền khi còn trống: lệnh
  // check-in không được âm thầm ghi đè giấy tờ đã đối chiếu trước đó. Đọc lại giá trị **thực sự đã lưu**
  // để nhật ký không ghi một số giấy tờ khác với dữ liệu (P3).
  let persistedIdNumber: string | null = null;
  if (write.idNumber !== undefined) {
    const persisted = await tx.$queryRaw<{ id_number: string | null }[]>`
      UPDATE guests SET id_number = COALESCE(id_number, ${write.idNumber}), updated_at = ${now}
      WHERE id = ${write.booking.guestId}::uuid RETURNING id_number`;
    persistedIdNumber = persisted[0]?.id_number ?? null;
  }
  try {
    await assignActualRooms(tx, write.booking, write.assignments, now);
  } catch (error) {
    inventoryError(error);
  }
  await tx.bookings.update({
    where: { id: write.booking.id },
    data: { status: 'CHECKED_IN', updated_at: now, version: { increment: 1 } },
  });
  await tx.booking_status_history.create({
    data: {
      booking_id: write.booking.id,
      from_status: write.booking.status,
      to_status: 'CHECKED_IN',
      reason: 'CHECKED_IN',
      actor_id: actor.id,
      at: now,
    },
  });
  if (write.debt !== null)
    await audit.record(tx, {
      actor,
      action: 'CHECKIN_DEBT_APPROVED',
      entityType: 'Booking',
      entityId: write.booking.id,
      beforeJson: { propertyId: write.booking.propertyId, balanceDue: write.balanceDue.toString() },
      afterJson: {
        propertyId: write.booking.propertyId,
        approvedDebt: write.debt.amount.toString(),
        collectionDeadline: write.debt.collectionDeadline,
        approverRole: actor.role,
      },
      // BR-FO-01: lý do duyệt nợ bắt buộc; người gọi không ghi thì server ghi lý do nghiệp vụ cố định.
      reason: write.note ?? 'Cho nợ khi nhận phòng',
    });
  await audit.record(tx, {
    actor,
    action: 'BOOKING_CHECKED_IN',
    entityType: 'Booking',
    entityId: write.booking.id,
    beforeJson: { propertyId: write.booking.propertyId, status: write.booking.status },
    afterJson: {
      propertyId: write.booking.propertyId,
      status: 'CHECKED_IN',
      roomIds: [...write.roomIds],
      earlyCheckInFee: write.earlyCheckInFee,
      balanceDue: write.balanceDue,
      // `AuditWriter` che khoá `idNumber` (NFR-SEC-03) — không tự chế bộ che thứ hai.
      idNumber: persistedIdNumber,
    },
    reason: write.note === undefined ? null : write.note,
  });
  return now;
}
