/**
 * SCR-37 (HB-109) — thu cọc / thu số dư tại quầy (UC-PAY-01, UC-PAY-03): phần thuần, kiểm bằng vitest.
 *
 * Quy tắc cứng của màn:
 * - Lệnh tài chính là tuyến 🔒: **chỉ** gửi khi đã `pin/verify` thành công trong **chính phiên thao tác**;
 *   PIN sai/bị khoá thì không gọi `POST /payments` (token chỉ giữ trong memory của component, không log/lưu).
 * - Số tiền do **máy chủ** quyết (`GET /bookings/{id}/balance` + `depositAmount` của booking): màn hình chỉ
 *   gợi ý mức còn phải thu và gửi đúng con số người dùng xác nhận; máy chủ vẫn kiểm lại (BR-PAY-01/02).
 * - Không có ô dữ liệu thẻ (BR-PAY-04) — chỉ tiền mặt/chuyển khoản tại quầy.
 */
import type { ApiError } from '@pinehill/api-client';
import type { BookingBalance, BookingSummary, Payment, PinToken } from '@pinehill/contracts';
import type { OperationsMessageKey } from '../../../../../lib/i18n';

/** Hai loại thu tại quầy của SCR-37 (cọc/số dư). */
export const COLLECT_TYPES = ['DEPOSIT', 'BALANCE'] as const;

export type CollectType = (typeof COLLECT_TYPES)[number];

/** Chỉ hai phương thức tại quầy; tuyệt đối không có trường dữ liệu thẻ. */
export const COLLECT_METHODS = ['CASH', 'BANK_TRANSFER'] as const;

export type CollectMethod = (typeof COLLECT_METHODS)[number];

export const COLLECT_TYPE_KEYS: Readonly<Record<CollectType, OperationsMessageKey>> = {
  DEPOSIT: 'ops.collect.type.DEPOSIT',
  BALANCE: 'ops.collect.type.BALANCE',
};

export const COLLECT_METHOD_KEYS: Readonly<Record<CollectMethod, OperationsMessageKey>> = {
  CASH: 'ops.collect.method.CASH',
  BANK_TRANSFER: 'ops.collect.method.BANK_TRANSFER',
};

export type PinStep = 'idle' | 'verifying' | 'verified' | 'locked';

export type PinIssue = 'FORMAT';

/** PIN tại quầy là 6 chữ số (không lưu, không log). */
export function pinIssue(pin: string): PinIssue | null {
  return /^\d{6}$/.test(pin) ? null : 'FORMAT';
}

export function pinGrantValid(grant: PinToken | null, now: number): boolean {
  return grant !== null && grant.pinToken.length >= 16 && Date.parse(grant.expiresAt) > now;
}

export interface PinFailure {
  readonly locked: boolean;
  readonly retryAfterSeconds: number | null;
}

/** Phân loại lỗi PIN: khoá thì dừng hẳn phiên thao tác; còn lại cho nhập lại. */
export function pinFailure(
  caught: unknown,
  isApiError: (value: unknown) => value is ApiError,
): PinFailure {
  if (!isApiError(caught)) return { locked: false, retryAfterSeconds: null };
  const locked = caught.code === 'E_AUTH_PIN_LOCKED';
  return {
    locked,
    retryAfterSeconds:
      typeof caught.retryAfterSeconds === 'number' ? caught.retryAfterSeconds : null,
  };
}

export type AmountIssue = 'FORMAT' | 'POSITIVE' | 'OVER';

/** Kiểm tại chỗ: số nguyên dương và không vượt mức máy chủ còn phải thu cho loại đang chọn. */
export function amountIssue(amount: string, dueAmount: number): AmountIssue | null {
  if (!/^\d+$/.test(amount.trim())) return 'FORMAT';
  const value = Number.parseInt(amount, 10);
  if (!Number.isSafeInteger(value)) return 'FORMAT';
  if (value <= 0) return 'POSITIVE';
  return value > dueAmount ? 'OVER' : null;
}

/** Dùng đúng khoản máy chủ trả; paidAmount không cho biết phân bổ nghĩa vụ (BR-PAY-02). */
export function suggestedAmount(
  booking: Pick<BookingSummary, 'depositAmount'>,
  balance: Pick<BookingBalance, 'paidAmount' | 'balanceDue'>,
  type: CollectType,
): number {
  if (type === 'BALANCE') return balance.balanceDue;
  return booking.depositAmount;
}

/** Chỉ gửi lệnh tài chính khi PIN đã xác thực trong phiên và số tiền đã hợp lệ. */
export function canSendPayment(step: PinStep, amountIssueValue: AmountIssue | null): boolean {
  return step === 'verified' && amountIssueValue === null;
}

export interface ReceiptLine {
  readonly key: OperationsMessageKey;
  readonly value: string;
}

/** Biên lai chỉ dùng Payment máy chủ trả, không suy người thu từ phiên hiện tại. */
export function receiptLines(payment: Payment): readonly ReceiptLine[] {
  return [
    { key: 'ops.collect.receipt.id', value: payment.paymentId },
    { key: 'ops.collect.receipt.booking', value: payment.bookingId },
    { key: 'ops.collect.receipt.type', value: payment.type },
    { key: 'ops.collect.receipt.method', value: payment.method },
    { key: 'ops.collect.receipt.amount', value: String(payment.amount) },
    { key: 'ops.collect.receipt.status', value: payment.status },
    { key: 'ops.collect.receipt.createdBy', value: payment.createdBy ?? '—' },
  ];
}
