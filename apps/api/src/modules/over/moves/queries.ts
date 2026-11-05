/**
 * Truy vấn chỉ đọc cho use case điều chuyển/walk-out (HB-125). Mọi hàm chạy trong transaction của
 * caller, không giữ khoá và không ghi; tệp này không chứa luật nghiệp vụ.
 */
import type { Clock } from '@pinehill/domain';
import {
  keepScore as scoreBooking,
  type KeepScoreBookingStatus,
  type LoyaltyTier,
  type StaffApproverRole,
} from '@pinehill/domain/overbooking';
import { money, nightsBetween, notFound } from '../support.js';
import type { Tx } from '../support.js';
import { activeAssignmentsOf, type BookingRow } from './writes.js';

const BOOKING_STATUSES: Readonly<Record<string, KeepScoreBookingStatus>> = {
  DRAFT: 'DRAFT',
  HELD: 'HELD',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  CHECKED_OUT: 'CHECKED_OUT',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
  EXPIRED: 'EXPIRED',
};

const LOYALTY_TIERS: Readonly<Record<string, LoyaltyTier>> = {
  PLATINUM: 'PLATINUM',
  GOLD: 'GOLD',
  SILVER: 'SILVER',
  MEMBER: 'MEMBER',
  GUEST: 'GUEST',
};

const STAFF_ROLES: Readonly<Record<string, StaffApproverRole>> = {
  FRONT_DESK: 'FRONT_DESK',
  RESERVATION_AGENT: 'RESERVATION_AGENT',
  HOUSEKEEPING: 'HOUSEKEEPING',
  MANAGER: 'MANAGER',
  OWNER: 'OWNER',
  ACCOUNTANT: 'ACCOUNTANT',
  SYSADMIN: 'SYSADMIN',
};

export interface OverbookingCaseRow {
  property_id: string;
  status: string;
}

export interface BookingRoomRow {
  id: string;
  room_type_id: string;
}

export interface RoomTypeRow {
  code: string;
  base_price: bigint;
}

/** Ca quá tải nguồn của lệnh điều chuyển; thiếu ⇒ 404 hợp đồng. */
export async function overbookingCaseOf(tx: Tx, caseId: string): Promise<OverbookingCaseRow> {
  const rows = await tx.$queryRaw<
    OverbookingCaseRow[]
  >`SELECT property_id, status FROM overbooking_cases WHERE id=${caseId}::uuid`;
  const row = rows[0];
  if (row === undefined) throw notFound('Không tìm thấy ca quá tải.');
  return row;
}

/** Đơn vị phòng của booking; đơn vị của booking khác cũng coi như không tồn tại. */
export async function bookingRoomOf(
  tx: Tx,
  bookingRoomId: string,
  bookingId: string,
): Promise<BookingRoomRow> {
  const rows = await tx.$queryRaw<BookingRoomRow[]>`SELECT id, room_type_id FROM booking_rooms
        WHERE id=${bookingRoomId}::uuid AND booking_id=${bookingId}::uuid`;
  const row = rows[0];
  if (row === undefined) throw notFound('Phòng của booking không tồn tại.');
  return row;
}

export async function roomOf(tx: Tx, assignmentId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<
    { room_id: string }[]
  >`SELECT room_id FROM room_assignments WHERE id=${assignmentId}::uuid`;
  return rows[0]?.room_id ?? null;
}

/** Phòng đang giữ đơn vị booking (`null` khi chưa có assignment hiệu lực). */
export async function currentRoomOf(tx: Tx, bookingRoomId: string): Promise<string | null> {
  const current = await activeAssignmentsOf(tx, bookingRoomId);
  if (current[0] === undefined) return null;
  return roomOf(tx, current[0].id);
}

export async function roomTypeOf(tx: Tx, roomTypeId: string): Promise<RoomTypeRow> {
  const rows = await tx.$queryRaw<
    RoomTypeRow[]
  >`SELECT code, base_price FROM room_types WHERE id=${roomTypeId}::uuid`;
  const row = rows[0];
  if (row === undefined) throw notFound('Không tìm thấy hạng phòng.');
  return row;
}

/** Điểm giữ khách (F6-D04) theo hạng thành viên, số đêm và số đã thu của booking. */
export async function keepScoreOf(
  tx: Tx,
  clock: Clock,
  booking: BookingRow,
  checkIn: string,
  checkOut: string,
): Promise<number> {
  const tier = await tx.$queryRaw<
    { loyalty_tier: string }[]
  >`SELECT loyalty_tier FROM guests WHERE id=${booking.guest_id}::uuid`;
  const scored = scoreBooking({
    loyaltyTier: LOYALTY_TIERS[tier[0]?.loyalty_tier ?? ''] ?? 'GUEST',
    paidAmountVnd: money(booking.paid_amount),
    totalAmountVnd: money(booking.total_amount),
    depositAmountVnd: money(booking.deposit_amount),
    nights: nightsBetween(checkIn, checkOut),
    staysLast12Months: 0,
    status: BOOKING_STATUSES[booking.status] ?? 'CONFIRMED',
    arrivalAtEpochMs: Date.parse(`${checkIn}T14:00:00+07:00`),
    nowEpochMs: clock.now().getTime(),
  });
  return scored.ok ? scored.value.total : 0;
}

/** Tiền đêm đầu theo ảnh chụp giá gốc; 0 khi booking chưa có charge ROOM. */
export async function firstNight(tx: Tx, bookingId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ amount: bigint }[]>`SELECT amount FROM booking_charges
        WHERE booking_id=${bookingId}::uuid AND kind='ROOM'
        ORDER BY stay_date NULLS LAST, id LIMIT 1`;
  const amount = rows[0]?.amount;
  return amount === undefined ? 0 : money(amount);
}

export async function approverOf(tx: Tx, userId: string | null): Promise<StaffApproverRole | null> {
  if (userId === null) return null;
  const rows = await tx.$queryRaw<
    { role: string }[]
  >`SELECT role FROM users WHERE id=${userId}::uuid`;
  return STAFF_ROLES[rows[0]?.role ?? ''] ?? null;
}
