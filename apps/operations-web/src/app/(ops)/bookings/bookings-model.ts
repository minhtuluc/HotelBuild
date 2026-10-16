/**
 * SCR-31 + SCR-32 (HB-106) — danh sách & chi tiết booking cho back-office: phần thuần, kiểm bằng vitest.
 *
 * Bộ lọc và phân trang đều **do máy chủ làm** (`GET /bookings` với `bookingsQuerySchema`); lớp này chỉ
 * đọc/ghi truy vấn URL, nối trang theo con trỏ và quyết định hiện lối "xoá cứng" — máy chủ vẫn là nơi
 * chặn (BR-BOOK-17/14, BR-RBAC-02).
 */
import { bookingStatusSchema } from '@pinehill/contracts';
import type { BookingStatus, BookingSummary, ListPage } from '@pinehill/contracts';
import { formatBusinessDate } from '../../../lib/business-date';
import { t, type OperationsMessageKey } from '../../../lib/i18n';

export interface BookingFilters {
  readonly propertyId: string;
  readonly status: BookingStatus | '';
  readonly channelCode: string;
  /** Từ khoá tra theo mã/SĐT (`q` của hợp đồng). */
  readonly q: string;
  readonly from: string;
  readonly to: string;
}

export const NO_FILTERS: BookingFilters = {
  propertyId: '',
  status: '',
  channelCode: '',
  q: '',
  from: '',
  to: '',
};

export const STATUS_KEYS: Readonly<Record<BookingStatus, OperationsMessageKey>> = {
  DRAFT: 'ops.bookings.status.DRAFT',
  HELD: 'ops.bookings.status.HELD',
  PENDING_PAYMENT: 'ops.bookings.status.PENDING_PAYMENT',
  CONFIRMED: 'ops.bookings.status.CONFIRMED',
  CHECKED_IN: 'ops.bookings.status.CHECKED_IN',
  CHECKED_OUT: 'ops.bookings.status.CHECKED_OUT',
  CANCELLED: 'ops.bookings.status.CANCELLED',
  NO_SHOW: 'ops.bookings.status.NO_SHOW',
  EXPIRED: 'ops.bookings.status.EXPIRED',
};

/** Đọc bộ lọc từ truy vấn URL; trạng thái lạ bị bỏ qua (không đoán). */
export function filtersFrom(searchParams: URLSearchParams): BookingFilters {
  const parsed = bookingStatusSchema.safeParse(searchParams.get('status') ?? '');
  return {
    propertyId: searchParams.get('propertyId') ?? '',
    status: parsed.success ? parsed.data : '',
    channelCode: searchParams.get('channelCode') ?? '',
    q: (searchParams.get('q') ?? '').trim(),
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
  };
}

/** Truy vấn URL mang bộ lọc (bỏ khoá rỗng) để mở lại/chia sẻ được đúng kết quả lọc. */
export function filtersToQuery(filters: BookingFilters): string {
  const params = new URLSearchParams();
  if (filters.propertyId !== '') params.set('propertyId', filters.propertyId);
  if (filters.status !== '') params.set('status', filters.status);
  if (filters.channelCode !== '') params.set('channelCode', filters.channelCode);
  if (filters.q !== '') params.set('q', filters.q);
  if (filters.from !== '') params.set('from', filters.from);
  if (filters.to !== '') params.set('to', filters.to);
  return params.toString();
}

export interface BookingListQuery {
  readonly limit: number;
  readonly propertyId?: string;
  readonly status?: BookingStatus;
  readonly channelCode?: string;
  readonly q?: string;
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: string;
}

/** Truy vấn gửi `GET /bookings`: chỉ những khoá hợp đồng cho phép và chỉ khi có giá trị. */
export function listQuery(
  filters: BookingFilters,
  limit: number,
  cursor: string | null,
): BookingListQuery {
  return {
    limit,
    ...(filters.propertyId === '' ? {} : { propertyId: filters.propertyId }),
    ...(filters.status === '' ? {} : { status: filters.status }),
    ...(filters.channelCode === '' ? {} : { channelCode: filters.channelCode }),
    ...(filters.q === '' ? {} : { q: filters.q }),
    ...(filters.from === '' ? {} : { from: filters.from }),
    ...(filters.to === '' ? {} : { to: filters.to }),
    ...(cursor === null ? {} : { cursor }),
  };
}

/** Nối trang mới vào danh sách đang có, khử trùng theo `id` (cuộn tiếp không nhân đôi dòng). */
export function appendBookings(
  previous: readonly BookingSummary[],
  page: ListPage<BookingSummary>,
): readonly BookingSummary[] {
  const seen = new Set(previous.map((booking) => booking.id));
  const merged = [...previous];
  for (const booking of page.data) {
    if (seen.has(booking.id)) continue;
    seen.add(booking.id);
    merged.push(booking);
  }
  return merged;
}

/** Con trỏ trang sau, chỉ khi máy chủ còn dữ liệu. */
export function nextCursorOf(page: ListPage<unknown>): string | null {
  return page.meta.hasMore ? page.meta.nextCursor : null;
}

/** BR-BOOK-17/14: chỉ DRAFT/HELD chưa phát sinh thanh toán mới có lối xoá cứng (máy chủ chặn lại lần nữa). */
export function canHardDelete(status: BookingStatus): boolean {
  return status === 'DRAFT' || status === 'HELD';
}

export interface BalanceRow {
  readonly key: 'paid' | 'balance';
  readonly amount: number;
}

/** Hai dòng tiền nhân viên cần thấy ngay ở danh sách/chi tiết (hợp đồng chưa có danh sách khoản thu). */
export function balanceRows(booking: {
  readonly paidAmount: number;
  readonly balanceDue: number;
}): readonly BalanceRow[] {
  return [
    { key: 'paid', amount: booking.paidAmount },
    { key: 'balance', amount: booking.balanceDue },
  ];
}

/** Kỳ lưu trú một dòng cho bảng: `24/12/2026 → 26/12/2026 · 2 đêm · 1 phòng`. */
export function stayOf(booking: {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly roomCount: number;
}): string {
  return t('ops.bookings.stayPeriod', {
    checkIn: formatBusinessDate(booking.checkIn),
    checkOut: formatBusinessDate(booking.checkOut),
    nights: booking.nights,
    roomCount: booking.roomCount,
  });
}
