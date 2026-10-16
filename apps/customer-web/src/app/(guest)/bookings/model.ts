/**
 * Lớp thuần cho SCR-09 (đơn của tôi) + SCR-10 (chi tiết booking của tôi).
 *
 * Ghi chú hợp đồng (HB-102, chủ dự án đã duyệt hướng "làm phần có được"): `GET /bookings` trả
 * `bookingSummarySchema`, `GET /bookings/{id}/balance` trả tổng đã thu/còn nợ. Hợp đồng **chưa** có
 * PriceSnapshot từng đêm, danh sách Payment và RoomAssignment nên hai màn này chỉ hiển thị phần có thật;
 * phần thiếu đã ghi vào PR để mở ticket hợp đồng riêng, không suy diễn số liệu trên giao diện.
 */
import { bookingStatusSchema } from '@pinehill/contracts';
import type { BookingBalance, BookingStatus, BookingSummary, ListPage } from '@pinehill/contracts';
import { formatStayPeriod } from '@pinehill/ui-web';
import type { CustomerMessageKey } from '../../../lib/i18n';
import { formatStaySpan } from './stay-format';

/** Nhãn trạng thái dùng chung cho danh sách và chi tiết (danh mục câu chữ ở `lib/i18n.ts`). */
export const STATUS_KEYS: Readonly<Record<BookingStatus, CustomerMessageKey>> = {
  DRAFT: 'guest.booking.status.DRAFT',
  HELD: 'guest.booking.status.HELD',
  PENDING_PAYMENT: 'guest.booking.status.PENDING_PAYMENT',
  CONFIRMED: 'guest.booking.status.CONFIRMED',
  CHECKED_IN: 'guest.booking.status.CHECKED_IN',
  CHECKED_OUT: 'guest.booking.status.CHECKED_OUT',
  CANCELLED: 'guest.booking.status.CANCELLED',
  NO_SHOW: 'guest.booking.status.NO_SHOW',
  EXPIRED: 'guest.booking.status.EXPIRED',
};

/**
 * Kỳ lưu trú một dòng của SCR-09/SCR-10: `24/12/2026 → 26/12/2026 · 2 đêm · 2 người lớn · 0 trẻ em`.
 *
 * Ghép hai helper dùng chung đã có (`formatStaySpan` + `formatStayPeriod`) để danh sách và chi tiết nói
 * cùng một câu; ngày lịch đổi sang `dd/MM/yyyy` bằng thao tác chuỗi, không dựng `Date`.
 */
export function stayText(booking: {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly adults: number;
  readonly children: number;
}): string {
  return formatStaySpan(
    booking.checkIn,
    booking.checkOut,
    formatStayPeriod(booking.nights, booking.adults, booking.children),
  );
}

export interface BookingFilters {
  /** `''` = tất cả trạng thái. */
  readonly status: BookingStatus | '';
  /** Từ khoá tra cứu theo mã/SĐT — chuyển thẳng thành `q` cho máy chủ lọc. */
  readonly q: string;
}

export const NO_FILTERS: BookingFilters = { status: '', q: '' };

/** Đọc bộ lọc từ truy vấn URL; giá trị trạng thái không hợp lệ bị bỏ qua (không đoán). */
export function filtersFrom(searchParams: URLSearchParams): BookingFilters {
  const parsed = bookingStatusSchema.safeParse(searchParams.get('status') ?? '');
  return { status: parsed.success ? parsed.data : '', q: (searchParams.get('q') ?? '').trim() };
}

/** Truy vấn URL mang bộ lọc (bỏ khoá rỗng) để mở lại/ chia sẻ được đúng kết quả. */
export function filtersToQuery(filters: BookingFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== '') params.set('status', filters.status);
  if (filters.q !== '') params.set('q', filters.q);
  return params.toString();
}

/** Nối trang mới vào danh sách đang có, khử trùng theo `id` (cuộn tiếp không nhân đôi dòng). */
export function appendPage<T extends { readonly id: string }>(
  previous: readonly T[],
  page: ListPage<T>,
): readonly T[] {
  const seen = new Set(previous.map((item) => item.id));
  const merged = [...previous];
  for (const item of page.data) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

/** Con trỏ trang sau, chỉ khi máy chủ còn dữ liệu. */
export function nextCursorOf(page: ListPage<unknown>): string | null {
  return page.meta.hasMore ? page.meta.nextCursor : null;
}

export interface BalanceRow {
  readonly key: 'total' | 'paid' | 'refunded' | 'reservedRefund' | 'due';
  readonly amount: number;
}

/** Các dòng số dư: "tổng" và "còn phải trả" luôn hiển thị; dòng bằng 0 thì ẩn. */
export function balanceRows(balance: BookingBalance): readonly BalanceRow[] {
  const rows: BalanceRow[] = [{ key: 'total', amount: balance.totalAmount }];
  if (balance.paidAmount > 0) rows.push({ key: 'paid', amount: balance.paidAmount });
  if (balance.refundedAmount > 0) rows.push({ key: 'refunded', amount: balance.refundedAmount });
  if (balance.reservedRefundAmount > 0)
    rows.push({ key: 'reservedRefund', amount: balance.reservedRefundAmount });
  rows.push({ key: 'due', amount: balance.balanceDue });
  return rows;
}

/** Booking còn giữ chỗ và còn số phải trả thì danh sách hiện lối tắt thanh toán. */
export function canPay(booking: BookingSummary): boolean {
  return (
    ['DRAFT', 'HELD', 'PENDING_PAYMENT'].includes(booking.status) &&
    booking.balanceDue > 0 &&
    booking.holdExpiresAt !== null
  );
}
