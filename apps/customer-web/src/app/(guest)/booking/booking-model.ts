/**
 * Lớp thuần cho SCR-07 (kết quả đặt & đếm ngược giữ chỗ).
 *
 * Nguyên tắc (HB-083 AC1): **hạn** giữ chỗ là mốc `holdExpiresAt` do máy chủ trả — màn hình không tự
 * tính hạn (không cộng trừ khoảng thời gian từ đồng hồ máy khách). Đồng hồ máy chỉ dùng để *đếm hiển
 * thị* giữa hai lần đọc máy chủ; khi đếm về 0 màn hình **đọc lại** trạng thái và chỉ máy chủ quyết định
 * (khoá nút tiếp tục nếu vẫn quá hạn, mở lại nếu máy chủ gia hạn).
 */
import type { BookingStatus } from '@pinehill/contracts';

/** Trạng thái booking còn giữ chỗ (còn phải thanh toán nên còn hạn giữ). */
const HOLDING_STATUSES: readonly BookingStatus[] = ['DRAFT', 'HELD', 'PENDING_PAYMENT'];

export interface HoldView {
  readonly kind: 'none' | 'active' | 'expired';
  /** Số mili giây còn lại theo mốc máy chủ; 0 khi không còn giữ chỗ hoặc đã quá hạn. */
  readonly remainingMs: number;
  readonly expiresAt: string | null;
}

export interface ContinueAction {
  readonly kind: 'pay' | 'locked' | 'none';
}

/** Số mili giây còn lại tới `expiresAt`; `null` khi không có mốc hoặc mốc không hợp lệ. */
export function remainingMs(expiresAt: string | null, nowMs: number): number | null {
  if (expiresAt === null) return null;
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/** `04:59` · từ 1 giờ: `1:00:00`. Luôn đếm ngược, không hiện số âm. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Trạng thái giữ chỗ suy từ **dữ liệu máy chủ**: chỉ booking còn giữ (DRAFT/HELD/PENDING_PAYMENT) và có
 * `holdExpiresAt` mới đếm ngược; còn lại là "không còn giữ chỗ" (không hiện đồng hồ cho booking đã huỷ).
 */
export function holdView(
  booking: { readonly status: BookingStatus; readonly holdExpiresAt: string | null },
  nowMs: number,
): HoldView {
  const remaining = remainingMs(booking.holdExpiresAt, nowMs);
  if (remaining === null || !HOLDING_STATUSES.includes(booking.status)) {
    return { kind: 'none', remainingMs: 0, expiresAt: booking.holdExpiresAt };
  }
  return remaining > 0
    ? { kind: 'active', remainingMs: remaining, expiresAt: booking.holdExpiresAt }
    : { kind: 'expired', remainingMs: 0, expiresAt: booking.holdExpiresAt };
}

/**
 * Thao tác "tiếp tục thanh toán": `none` khi không còn gì phải trả hoặc booking đã chốt/huỷ; `locked`
 * khi hết hạn giữ chỗ (AC1: khoá nút); `pay` khi còn giữ chỗ và còn số phải trả.
 */
export function continueAction(
  booking: { readonly status: BookingStatus; readonly balanceDue: number },
  hold: HoldView,
): ContinueAction {
  if (!HOLDING_STATUSES.includes(booking.status) || booking.balanceDue <= 0)
    return { kind: 'none' };
  return hold.kind === 'expired' ? { kind: 'locked' } : { kind: 'pay' };
}

/**
 * Đích của "tiếp tục thanh toán" — SCR-06 (thanh toán trực tuyến, ticket riêng). Màn này **không** dựng
 * cổng thanh toán, chỉ chuyển tuyến theo journey đã thiết kế.
 */
export function continueHref(bookingId: string): string {
  return `/booking/${encodeURIComponent(bookingId)}/pay`;
}

export interface MoneyRow {
  readonly key: 'total' | 'deposit' | 'paid' | 'penalty' | 'balance';
  readonly amount: number;
}

/** Các dòng tiền hiển thị: bỏ dòng bằng 0 (trừ "tổng" và "còn phải trả" luôn hiện để không gây hiểu sai). */
export function moneyRows(booking: {
  readonly totalAmount: number;
  readonly depositAmount: number;
  readonly paidAmount: number;
  readonly penaltyAmount: number;
  readonly balanceDue: number;
}): readonly MoneyRow[] {
  const rows: MoneyRow[] = [
    { key: 'total', amount: booking.totalAmount },
    { key: 'deposit', amount: booking.depositAmount },
  ];
  if (booking.paidAmount > 0) rows.push({ key: 'paid', amount: booking.paidAmount });
  if (booking.penaltyAmount > 0) rows.push({ key: 'penalty', amount: booking.penaltyAmount });
  rows.push({ key: 'balance', amount: booking.balanceDue });
  return rows;
}
