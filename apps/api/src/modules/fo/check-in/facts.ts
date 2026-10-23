/**
 * Khoá + đọc dữ kiện cho `POST /front-office/check-in` (HB-144, BR-FO-07).
 *
 * Thứ tự khoá theo ADR-014: `bookings → properties → room_types` (do `lockBooking` của HB-077 lo),
 * rồi `booking_rooms`, rồi `rooms` (`ORDER BY id`). Nhờ vậy check-in của hai quầy và bước cập nhật
 * nhiệm vụ buồng phòng (HB-148 cũng khoá `rooms`) không chen được giữa bước kiểm sẵn sàng và bước ghi.
 * Không đọc `bookings.balance_due` làm số dư quyết định — sổ cái HB-093 là nguồn duy nhất (BR-PAY-02).
 */
import type { Prisma } from '@prisma/client';
import type { CheckInUnit } from '@pinehill/domain/front-office';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { lockBooking } from '../../book/bookings/lock.js';
import type { LockedBooking } from '../../book/bookings/lock.js';
import type { BookingLedger } from '../../pay/ledger/service.js';
import { conflict, invalid, missing } from './errors.js';
import { matchRoomsToUnits } from './matching.js';
import type { UnitRoom } from './matching.js';
import type { Command } from './validation.js';

type Tx = Prisma.TransactionClient;

const ROOM_STATUS: Readonly<Record<string, CheckInUnit['status']>> = {
  ACTIVE: 'ACTIVE',
  MAINTENANCE: 'MAINTENANCE',
  INACTIVE: 'INACTIVE',
};

const READINESS: Readonly<Record<string, NonNullable<CheckInUnit['readinessForCurrentRelease']>>> =
  {
    DONE: 'DONE',
    INSPECTED: 'INSPECTED',
    VERIFIED: 'VERIFIED',
    PENDING: 'PENDING',
    IN_PROGRESS: 'IN_PROGRESS',
  };

export interface LockedRoom {
  readonly id: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly status: CheckInUnit['status'];
}

/**
 * Khoá phòng vật lý rồi trả trạng thái đã ổn định; thiếu/khác cơ sở ⇒ 404 để không lộ dữ liệu.
 *
 * Phòng ở ghép (DOR, `room_types.allow_shared`) bị từ chối **trước** khi ghi assignment: hợp đồng
 * `actualRoomIds` không có chiều giường nên `bed_no = 0` sẽ bị trigger `fn_guard_bed_no` chặn bằng
 * SQLSTATE 23514 (lỗi hệ thống). Từ chối 409 ở đây cũng làm bước kiểm "khách cũ" không cần biết giường.
 */
export async function lockRooms(
  tx: Tx,
  propertyId: string,
  roomIds: readonly string[],
): Promise<readonly LockedRoom[]> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      property_id: string;
      room_type_id: string;
      status: string;
      allow_shared: boolean;
    }[]
  >`SELECT r.id, r.property_id, r.room_type_id, r.status, rt.allow_shared
      FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
     WHERE r.id = ANY(${roomIds}::uuid[]) ORDER BY r.id FOR UPDATE OF r`;
  if (rows.length !== roomIds.length || rows.some((row) => row.property_id !== propertyId))
    throw missing();
  if (rows.some((row) => row.allow_shared))
    throw conflict('Chưa hỗ trợ nhận phòng theo giường (phòng ở ghép).');
  return rows.map((row) => {
    const status = ROOM_STATUS[row.status];
    if (status === undefined) throw conflict('Trạng thái phòng vật lý không hợp lệ để giao.');
    return {
      id: row.id,
      propertyId: row.property_id,
      roomTypeId: row.room_type_id,
      status,
    };
  });
}

/** Phòng đang có khách khác chưa trả (assignment còn hiệu lực, chồng kỳ lưu trú). */
export async function occupiedRooms(
  tx: Tx,
  roomIds: readonly string[],
  bookingId: string,
  checkIn: Date,
  checkOut: Date,
): Promise<ReadonlyMap<string, true>> {
  const rows = await tx.$queryRaw<{ room_id: string }[]>`
    SELECT DISTINCT a.room_id FROM room_assignments a
      JOIN booking_rooms br ON br.id = a.booking_room_id
     WHERE a.room_id = ANY(${roomIds}::uuid[])
       AND a.released_at IS NULL
       AND br.booking_id <> ${bookingId}::uuid
       AND a.start_date < ${checkOut}::date
       AND a.end_date >= ${checkIn}::date
     ORDER BY a.room_id`;
  return new Map(rows.map((row) => [row.room_id, true]));
}

/** Phòng bị chặn đúng ngày giao (BR-FO-07: "không block tại thời điểm giao"). */
export async function blockedRooms(
  tx: Tx,
  roomIds: readonly string[],
  businessDate: string,
): Promise<ReadonlyMap<string, true>> {
  const rows = await tx.$queryRaw<{ room_id: string }[]>`
    SELECT DISTINCT room_id FROM room_blocks
     WHERE room_id = ANY(${roomIds}::uuid[])
       AND start_date <= ${businessDate}::date
       AND end_date > ${businessDate}::date
     ORDER BY room_id`;
  return new Map(rows.map((row) => [row.room_id, true]));
}

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

/**
 * Bằng chứng sẵn sàng của **lượt giải phóng gần nhất** (BR-FO-07, HB-206/F7-QA-05): nhiệm vụ buồng phòng
 * mới nhất `business_date ∈ [L, ngày nhận phòng]` của từng phòng, trong đó `L` là ngày giải phóng gần nhất
 * của một lượt ở **đã diễn ra** (booking khác `CHECKED_IN`/`CHECKED_OUT`; ngày nhả theo giờ VN, chưa nhả thì
 * `end_date`; loại dòng nhả do đổi phòng lúc nhận vì phòng đó chưa ai ở) với `L ≤` ngày nhận phòng.
 * Phòng chưa từng có lượt ở: `L` = ngày nhận phòng ⇒ chỉ nhiệm vụ đúng ngày đó (luật cũ, bộ khoá HB-143).
 * Nhiệm vụ trước `L` thuộc lượt trước nên không chứng minh phòng sạch sau lượt ở mới.
 */
export async function readinessTasks(
  tx: Tx,
  roomIds: readonly string[],
  bookingId: string,
  businessDate: string,
): Promise<ReadonlyMap<string, CheckInUnit['readinessForCurrentRelease']>> {
  const rows = await tx.$queryRaw<{ room_id: string; status: string }[]>`
    WITH last_release AS (
      SELECT a.room_id,
             max(coalesce((a.released_at AT TIME ZONE ${TIME_ZONE})::date, a.end_date)) AS released_on
        FROM room_assignments a
        JOIN booking_rooms br ON br.id = a.booking_room_id
        JOIN bookings b ON b.id = br.booking_id
       WHERE a.room_id = ANY(${roomIds}::uuid[])
         AND br.booking_id <> ${bookingId}::uuid
         AND b.status IN ('CHECKED_IN', 'CHECKED_OUT')
         AND coalesce(a.release_reason, '') <> 'CHECKIN_ROOM_CHANGED'
         AND coalesce((a.released_at AT TIME ZONE ${TIME_ZONE})::date, a.end_date) <= ${businessDate}::date
       GROUP BY a.room_id)
    SELECT DISTINCT ON (t.room_id) t.room_id, t.status::text AS status
      FROM housekeeping_tasks t
      LEFT JOIN last_release l ON l.room_id = t.room_id
     WHERE t.room_id = ANY(${roomIds}::uuid[])
       AND t.business_date <= ${businessDate}::date
       AND t.business_date >= coalesce(l.released_on, ${businessDate}::date)
     ORDER BY t.room_id, t.business_date DESC, t.created_at DESC, t.id DESC`;
  const readiness = new Map<string, CheckInUnit['readinessForCurrentRelease']>();
  for (const row of rows) readiness.set(row.room_id, READINESS[row.status] ?? null);
  return readiness;
}

/** Giá đêm đầu theo nghĩa vụ ROOM đã chốt (§3.6) — engine dùng cho phụ thu check-in sớm BR-FO-04. */
export async function firstNightAmount(tx: Tx, bookingId: string, checkIn: Date): Promise<bigint> {
  const rows = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT coalesce(sum(amount - voided_amount), 0)::bigint AS total
      FROM booking_charges
     WHERE booking_id = ${bookingId}::uuid AND kind = 'ROOM' AND stay_date = ${checkIn}::date`;
  return rows[0]!.total;
}

/** Ngưỡng cho nợ của MANAGER đọc từ `SystemSetting` (BR-SYS-02), mặc định 5.000.000 và 50%. */
export async function managerDebtLimits(
  tx: Tx,
): Promise<{ readonly amount: number; readonly percent: number }> {
  const rows = await tx.system_settings.findMany({
    where: { key: { in: ['deal.threshold.checkInDebt', 'deal.threshold.checkInDebtPct'] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const setting = (key: string, fallback: bigint, max: bigint): number => {
    const raw = byKey.get(key);
    let value: bigint;
    try {
      value = raw === undefined ? fallback : BigInt(raw);
    } catch {
      value = fallback;
    }
    if (value < 0n || value > max) value = fallback;
    return Number(value);
  };
  return {
    amount: setting('deal.threshold.checkInDebt', 5_000_000n, BigInt(Number.MAX_SAFE_INTEGER)),
    percent: setting('deal.threshold.checkInDebtPct', 50n, 100n),
  };
}

/** VND nguyên trong khoảng biểu diễn được của `number` — engine HB-141 nhận `number`. */
export function money(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error('CHECKIN_AMOUNT_UNREPRESENTABLE');
  return amount;
}

export interface CheckInFacts {
  readonly booking: LockedBooking;
  /** Ghép phòng thực tế ↔ đơn vị bán (theo thứ tự `booking_rooms.id`), độc lập thứ tự `actualRoomIds`. */
  readonly assignments: readonly UnitRoom[];
  readonly units: readonly CheckInUnit[];
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly balanceDue: bigint;
  readonly firstNight: bigint;
  readonly limits: { readonly amount: number; readonly percent: number };
}

/**
 * Khoá booking → `booking_rooms` → `rooms` (ADR-014) rồi đọc mọi dự kiện quyết định trong cùng
 * transaction. Số dư lấy từ sổ cái HB-093; sẵn sàng lấy từ nhiệm vụ buồng phòng của **ngày nhận phòng**
 * (lượt giải phóng hiện tại), không lấy task cũ.
 */
export async function lockCheckInFacts(
  tx: Tx,
  actor: AuthorizedActor,
  input: Command,
  ledger: BookingLedger,
): Promise<CheckInFacts> {
  const booking = await lockBooking(tx, input.bookingId);
  requireProperty(actor, booking.propertyId);
  const bookingRooms = await tx.booking_rooms.findMany({
    where: { booking_id: booking.id },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  // `actualRoomIds` giao đúng một phòng thực tế cho mỗi đơn vị bán của booking.
  if (bookingRooms.length === 0 || bookingRooms.length !== input.actualRoomIds.length)
    throw invalid();
  await tx.$queryRaw`SELECT id FROM booking_rooms
    WHERE booking_id = ${booking.id}::uuid ORDER BY id FOR UPDATE`;
  const rooms = await lockRooms(tx, booking.propertyId, input.actualRoomIds);
  const byRoom = new Map(rooms.map((room) => [room.id, room]));
  // Điều chuyển/nâng hạng phải làm trước bằng `POST /room-moves`; check-in không tự đổi loại phòng.
  if (rooms.some((room) => room.roomTypeId !== booking.roomTypeId))
    throw conflict('Phòng thực tế không thuộc loại phòng đã đặt.');

  const projection = await ledger.read(tx, booking.id);
  const checkInDate = booking.checkIn.toISOString().slice(0, 10);
  const occupied = await occupiedRooms(
    tx,
    input.actualRoomIds,
    booking.id,
    booking.checkIn,
    booking.checkOut,
  );
  const blocked = await blockedRooms(tx, input.actualRoomIds, checkInDate);
  const readiness = await readinessTasks(tx, input.actualRoomIds, booking.id, checkInDate);
  const current = await tx.$queryRaw<{ booking_room_id: string; room_id: string }[]>`
    SELECT booking_room_id, room_id FROM room_assignments
     WHERE booking_room_id = ANY(${bookingRooms.map((room) => room.id)}::uuid[]) AND released_at IS NULL
     ORDER BY booking_room_id, id`;
  const assignments = matchRoomsToUnits(
    bookingRooms.map((room) => room.id),
    new Map(current.map((row) => [row.booking_room_id, row.room_id])),
    input.actualRoomIds,
  );
  return {
    booking,
    assignments,
    units: input.actualRoomIds.map((roomId) => ({
      roomId,
      bedNo: 0,
      status: byRoom.get(roomId)!.status,
      blockedAtHandover: blocked.has(roomId),
      occupiedAtHandover: occupied.has(roomId),
      readinessForCurrentRelease: readiness.get(roomId) ?? null,
    })),
    checkInDate,
    checkOutDate: booking.checkOut.toISOString().slice(0, 10),
    balanceDue: projection.balanceDue,
    firstNight: await firstNightAmount(tx, booking.id, booking.checkIn),
    limits: await managerDebtLimits(tx),
  };
}
