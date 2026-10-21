/**
 * SCR-62 — chiếu kết quả máy chủ sang mô hình hiển thị và che PII theo vai trò.
 *
 * Máy chủ trả `GuestSummary` đầy đủ (NFR-COMP-01) và **không** cắt theo vai trò; vì vậy màn hình
 * chỉ hiển thị tập trường tối thiểu và che PII tại đây (NFR-SEC-03: `****` + 4 ký tự cuối):
 * - `MANAGER`/`OWNER`: đủ hồ sơ (email, hạng, điểm, số lần lưu trú).
 * - `FRONT_DESK`/`RESERVATION_AGENT`: chỉ trường tác nghiệp — họ tên và SĐT để đón/gọi khách,
 *   email đã che, **không** có lịch sử/hạng/điểm; tài liệu (`idNumber`, `dob`, `nationality`)
 *   không nằm trong mô hình hiển thị nên không thể lọt xuống UI.
 * - Vai trò khác: máy chủ cũng từ chối (`bookings.read` chỉ 4 vai trò trên), màn hình hiện `forbidden`.
 *
 * Cờ danh sách đen **luôn** lấy từ `GuestSummary.blacklisted` của máy chủ, không suy ra ở client
 * (BR-CRM-04 do máy chủ áp khi tạo booking).
 */
import type {
  BookingStatus,
  BookingSummary,
  GuestSummary,
  LoyaltyTier,
  UserRole,
} from '@pinehill/contracts';
import { formatBusinessDate } from '../housekeeping/date';

export type LookupAccess = 'full' | 'operational' | 'denied';

export function lookupAccess(role: UserRole): LookupAccess {
  if (role === 'OWNER' || role === 'MANAGER') return 'full';
  if (role === 'FRONT_DESK' || role === 'RESERVATION_AGENT') return 'operational';
  return 'denied';
}

/** `****` + tối đa 4 ký tự cuối (NFR-SEC-03); chuỗi ngắn hơn thì chỉ còn `****`. */
export function maskPii(value: string, keep = 4): string {
  if (value.length <= keep) return '****';
  return `****${value.slice(-keep)}`;
}

export function maskEmail(email: string | null): string | null {
  return email === null ? null : maskPii(email);
}

export interface GuestHistory {
  readonly tier: LoyaltyTier;
  readonly points: number;
  readonly totalStays: number;
}

export interface GuestView {
  readonly id: string;
  readonly fullName: string;
  readonly phone: string;
  readonly email: string | null;
  readonly blacklisted: boolean;
  /** `null` = vai trò không được xem lịch sử/hạng/điểm. */
  readonly history: GuestHistory | null;
}

export function toGuestView(
  guest: GuestSummary,
  access: Exclude<LookupAccess, 'denied'>,
): GuestView {
  const full = access === 'full';
  return {
    id: guest.id,
    fullName: guest.fullName,
    phone: guest.phone,
    email: full ? guest.email : maskEmail(guest.email),
    blacklisted: guest.blacklisted,
    history: full
      ? { tier: guest.loyaltyTier, points: guest.loyaltyPoints, totalStays: guest.totalStays }
      : null,
  };
}

export interface BookingView {
  readonly id: string;
  readonly code: string;
  readonly status: BookingStatus;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly roomCount: number;
  readonly totalAmount: number;
  readonly balanceDue: number;
  readonly guestId: string;
  readonly guestName: string | null;
  /** `null` = hồ sơ khách không nằm trong cùng kết quả nên chưa đối chiếu được cờ. */
  readonly blacklisted: boolean | null;
}

export function toBookingView(
  booking: BookingSummary,
  guests: ReadonlyMap<string, GuestView>,
): BookingView {
  const guest = guests.get(booking.guestId) ?? null;
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.nights,
    roomCount: booking.roomCount,
    totalAmount: booking.totalAmount,
    balanceDue: booking.balanceDue,
    guestId: booking.guestId,
    guestName: guest?.fullName ?? null,
    blacklisted: guest?.blacklisted ?? null,
  };
}

export type LookupRow =
  | { readonly kind: 'booking'; readonly booking: BookingView }
  | { readonly kind: 'guest'; readonly guest: GuestView };

export function guestIndex(guests: readonly GuestView[]): ReadonlyMap<string, GuestView> {
  return new Map(guests.map((guest) => [guest.id, guest]));
}

/** Booking trước (kết quả chính khi tra mã/SĐT), rồi tới hồ sơ khách. */
export function buildRows(
  guests: readonly GuestView[],
  bookings: readonly BookingView[],
): readonly LookupRow[] {
  return [
    ...bookings.map((booking) => ({ kind: 'booking' as const, booking })),
    ...guests.map((guest) => ({ kind: 'guest' as const, guest })),
  ];
}

/** Tiền là số nguyên VND (hợp đồng `min(0).int()`); định dạng vi-VN, không chia nhỏ đơn vị. */
export function formatVnd(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new RangeError(`Số tiền không hợp lệ: ${amount}`);
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`;
}

export function formatStay(checkIn: string, checkOut: string, nights: number): string {
  return `${formatBusinessDate(checkIn)} → ${formatBusinessDate(checkOut)} · ${nights} đêm`;
}
