/**
 * Truy vấn và khoá dùng chung cho luồng ghép phòng (HB-125). Mọi hàm nhận `tx` đang mở nên giữ
 * nguyên ranh giới giao dịch của service gọi; thứ tự khoá booking (theo id) rồi phòng là bất biến.
 */
import type { PrismaClient } from '@prisma/client';
import type { StaffApproverRole } from '@pinehill/domain/overbooking';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import {
  lockBooking,
  reduceObligation,
  type BookingRow,
  type RoomTarget,
} from '../moves/writes.js';
import { businessConflict, invalid, notFound, requireProperties, type Tx } from '../support.js';
import type { MergeRow } from '../views.js';

export interface TypeRow {
  allow_shared: boolean;
  capacity_adults: number;
  base_price: bigint;
}

export interface ConnectedRoom extends RoomTarget {
  connecting_room_id: string | null;
  code: string;
}

const FLOOR = 1000;

export function floorThousand(value: number): number {
  return Math.floor(value / FLOOR) * FLOOR;
}

/** Khoá hai booking theo thứ tự id tăng dần, trả về đúng vai trò primary/secondary yêu cầu. */
export async function lockBookingPair(
  tx: Tx,
  primaryBookingId: string,
  secondaryBookingId: string,
): Promise<{ primary: BookingRow; secondary: BookingRow }> {
  const ids = [primaryBookingId, secondaryBookingId].sort();
  const first = await lockBooking(tx, ids[0]!);
  const second = await lockBooking(tx, ids[1]!);
  return first.id === primaryBookingId
    ? { primary: first, secondary: second }
    : { primary: second, secondary: first };
}

export async function lockMerge(tx: Tx, mergeId: string): Promise<MergeRow> {
  const rows = await tx.$queryRaw<MergeRow[]>`
    SELECT * FROM room_merges WHERE id=${mergeId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw notFound('Không tìm thấy lệnh ghép phòng.');
  return row;
}

export async function insertMerge(
  tx: Tx,
  input: {
    primaryBookingId: string;
    secondaryBookingId: string | null;
    roomId: string;
    secondaryRoomId: string | null;
    moveType: string;
    discountPct: number;
    discountAmount: bigint;
    status: string;
  },
): Promise<MergeRow> {
  const rows = await tx.$queryRaw<MergeRow[]>`
    INSERT INTO room_merges(primary_booking_id, secondary_booking_id, room_id,
      secondary_room_id, move_type, consent_primary, consent_secondary, discount_pct,
      discount_amount, status)
    VALUES(${input.primaryBookingId}::uuid, ${input.secondaryBookingId}::uuid,
      ${input.roomId}::uuid, ${input.secondaryRoomId}::uuid, ${input.moveType},
      false, false, ${input.discountPct}::numeric, ${input.discountAmount}, ${input.status})
    RETURNING *`;
  return rows[0]!;
}

export async function roomType(tx: Tx, roomTypeId: string): Promise<TypeRow> {
  const rows = await tx.$queryRaw<TypeRow[]>`
    SELECT allow_shared, capacity_adults, base_price
      FROM room_types WHERE id=${roomTypeId}::uuid`;
  const row = rows[0];
  if (row === undefined) throw notFound('Không tìm thấy hạng phòng.');
  return row;
}

export async function connectedRoom(tx: Tx, roomId: string): Promise<ConnectedRoom> {
  const rows = await tx.$queryRaw<ConnectedRoom[]>`
    SELECT r.id, r.property_id, r.room_type_id, r.status, r.bed_count, r.connecting_room_id,
           r.code, rt.allow_shared, rt.capacity_adults, rt.base_price
      FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id
     WHERE r.id=${roomId}::uuid`;
  const row = rows[0];
  if (row === undefined) throw notFound('Không tìm thấy phòng ghép.');
  return row;
}

/** roomId → booking_room_id đang giữ phòng; với `roomIds` rỗng trả mọi unit đang giữ. */
export async function assignedUnits(
  tx: Tx,
  bookingId: string,
  roomIds: readonly string[],
): Promise<Map<string, string>> {
  const rows =
    roomIds.length === 0
      ? await tx.$queryRaw<
          { room_id: string; booking_room_id: string }[]
        >`SELECT ra.room_id, ra.booking_room_id
            FROM room_assignments ra JOIN booking_rooms br ON br.id=ra.booking_room_id
           WHERE br.booking_id=${bookingId}::uuid AND ra.released_at IS NULL`
      : await tx.$queryRaw<
          { room_id: string; booking_room_id: string }[]
        >`SELECT ra.room_id, ra.booking_room_id
            FROM room_assignments ra JOIN booking_rooms br ON br.id=ra.booking_room_id
           WHERE br.booking_id=${bookingId}::uuid AND ra.released_at IS NULL
             AND ra.room_id = ANY(${[...roomIds]}::uuid[])`;
  const units = new Map<string, string>();
  for (const row of rows) units.set(row.room_id, row.booking_room_id);
  return units;
}

export async function firstBookingRoom(tx: Tx, bookingId: string): Promise<string> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM booking_rooms WHERE booking_id=${bookingId}::uuid ORDER BY id LIMIT 1`;
  const id = rows[0]?.id;
  if (id === undefined) throw notFound('Booking không có đơn vị phòng.');
  return id;
}

/** `count` giường trống nhỏ nhất của phòng trong kỳ; giường 0 (cả phòng) khoá toàn bộ. */
export async function freeBeds(
  tx: Tx,
  roomId: string,
  checkIn: string,
  checkOut: string,
  bedCount: number,
  count: number,
): Promise<number[]> {
  const rows = await tx.$queryRaw<{ bed_no: number }[]>`SELECT DISTINCT bed_no FROM room_assignments
      WHERE room_id=${roomId}::uuid AND released_at IS NULL
        AND valid_range && daterange(${checkIn}::date, ${checkOut}::date, '[)')`;
  const taken = new Set(rows.map((row) => Number(row.bed_no)));
  const free: number[] = [];
  if (!taken.has(0))
    for (let bed = 1; bed <= bedCount && free.length < count; bed += 1)
      if (!taken.has(bed)) free.push(bed);
  if (free.length < count)
    throw businessConflict('E_INV_ROOM_TAKEN', 'Phòng ghép không đủ giường trống.');
  return free;
}

export async function chargeSum(tx: Tx, bookingId: string): Promise<bigint> {
  const rows = await tx.$queryRaw<
    { total: bigint }[]
  >`SELECT coalesce(sum(amount - voided_amount),0)::bigint AS total
      FROM booking_charges WHERE booking_id=${bookingId}::uuid AND kind='ROOM'`;
  return rows[0]?.total ?? 0n;
}

export async function chargeSumOfRoom(tx: Tx, bookingRoomId: string): Promise<bigint> {
  const rows = await tx.$queryRaw<
    { total: bigint }[]
  >`SELECT coalesce(sum(amount - voided_amount),0)::bigint AS total
      FROM booking_charges WHERE booking_room_id=${bookingRoomId}::uuid AND kind='ROOM'`;
  return rows[0]?.total ?? 0n;
}

/** F6-D03: nghĩa vụ mới = floor1000(doanh thu − chiết khấu), ghi bằng void phần chênh. */
export async function applyDiscount(
  tx: Tx,
  bookingId: string,
  netAfterDiscount: number,
  now: Date,
): Promise<void> {
  const current = await chargeSum(tx, bookingId);
  const target = BigInt(floorThousand(netAfterDiscount));
  if (target > current) throw invalid('Chiết khấu ghép không được tăng nghĩa vụ.');
  await reduceObligation(tx, bookingId, current - target, now);
}

export async function gendersOf(
  tx: Tx | PrismaClient,
  guestIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(guestIds.filter((id) => id.length > 0))];
  if (unique.length === 0) return new Map();
  const rows = await tx.$queryRaw<
    { id: string; gender: string }[]
  >`SELECT id, gender FROM guests WHERE id = ANY(${unique}::uuid[])`;
  return new Map(rows.map((row) => [row.id, row.gender]));
}

/** Giá trị `users.role` hợp lệ (csdl) → kiểu vai trò duyệt của domain, không ép kiểu. */
const STAFF_ROLES: Readonly<Record<string, StaffApproverRole>> = {
  FRONT_DESK: 'FRONT_DESK',
  RESERVATION_AGENT: 'RESERVATION_AGENT',
  HOUSEKEEPING: 'HOUSEKEEPING',
  MANAGER: 'MANAGER',
  OWNER: 'OWNER',
  ACCOUNTANT: 'ACCOUNTANT',
  SYSADMIN: 'SYSADMIN',
};

export async function requireMergeScope(
  tx: Tx | PrismaClient,
  actor: AuthorizedActor,
  row: MergeRow,
): Promise<void> {
  const bookingIds = [row.primary_booking_id, row.secondary_booking_id].filter(
    (id): id is string => id !== null,
  );
  const bookings = await tx.$queryRaw<
    { property_id: string }[]
  >`SELECT property_id FROM bookings WHERE id = ANY(${bookingIds}::uuid[])`;
  const roomIds = [row.room_id, row.secondary_room_id].filter((id): id is string => id !== null);
  const rooms = await tx.$queryRaw<
    { property_id: string }[]
  >`SELECT property_id FROM rooms WHERE id = ANY(${roomIds}::uuid[])`;
  requireProperties(actor, [
    ...bookings.map((item) => item.property_id),
    ...rooms.map((item) => item.property_id),
  ]);
}

export async function approverOf(tx: Tx, userId: string | null): Promise<StaffApproverRole | null> {
  if (userId === null) return null;
  const rows = await tx.$queryRaw<
    { role: string }[]
  >`SELECT role FROM users WHERE id=${userId}::uuid`;
  return STAFF_ROLES[rows[0]?.role ?? ''] ?? null;
}
