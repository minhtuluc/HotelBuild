/**
 * SCR-59/60/61 (HB-154) — phần thuần của thu số dư và trả phòng, kiểm bằng vitest.
 *
 * Ranh giới (ADR-018): màn hình **không** tự tính phụ thu trả muộn, số dư hay điều kiện trả phòng. Danh
 * sách khách đi là trình bày dữ liệu `GET /bookings`; số tiền hiển thị luôn là số máy chủ trả (đọc lại
 * `GET /bookings/{id}/balance` sau khi máy chủ ghi nghĩa vụ). Cờ `earlyCheckOut` chỉ là giá trị khởi tạo
 * của biểu mẫu — máy chủ đối chiếu với ngày thực tế và từ chối nếu lệch (BR-CANCEL-09).
 */
import { isApiError } from '@pinehill/api-client';
import type { BookingSummary, PaymentCreateRequest } from '@pinehill/contracts';
import { actionFailure, type ActionFailure } from '../arrivals/model';

const byCode = (left: BookingSummary, right: BookingSummary): number =>
  left.code.localeCompare(right.code);

/** Đang ở và đến hạn trả hôm nay hoặc quá hạn (để không bỏ sót khách trả muộn); máy chủ quyết phụ thu. */
export function departuresOf(source: readonly BookingSummary[], date: string): BookingSummary[] {
  return source
    .filter((booking) => booking.status === 'CHECKED_IN' && booking.checkOut <= date)
    .sort(byCode);
}

/** Ngày trả phòng sau ngày nghiệp vụ hiện tại ⇒ khởi tạo "trả sớm"; chỉ là gợi ý, máy chủ đối chiếu. */
export function isEarlyCheckOut(booking: Pick<BookingSummary, 'checkOut'>, date: string): boolean {
  return booking.checkOut > date;
}

/** PIN tại quầy là 6 chữ số (không lưu, không log). */
export function pinIssue(pin: string): 'FORMAT' | null {
  return /^\d{6}$/.test(pin) ? null : 'FORMAT';
}

export type AmountIssue = 'FORMAT' | 'POSITIVE' | 'OVER';

/** Số nguyên VND dương, không vượt mức máy chủ báo còn phải thu; máy chủ vẫn kiểm lại (BR-PAY-01/02). */
export function amountIssue(raw: string, due: number): AmountIssue | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return 'FORMAT';
  const value = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(value)) return 'FORMAT';
  if (value <= 0) return 'POSITIVE';
  return value > due ? 'OVER' : null;
}

/** Chỉ hai phương thức tại quầy; không có trường dữ liệu thẻ (BR-PAY-04). */
export const COUNTER_METHODS = ['CASH', 'BANK_TRANSFER'] as const;
export type CounterMethod = (typeof COUNTER_METHODS)[number];

export interface CollectDraft {
  readonly method: CounterMethod;
  readonly amount: string;
  readonly note: string;
}

export type CollectBody = Omit<PaymentCreateRequest, 'pinToken'>;

export function collectBody(bookingId: string, draft: CollectDraft): CollectBody {
  if (amountIssue(draft.amount, Number.MAX_SAFE_INTEGER) !== null)
    throw new RangeError('Số tiền không hợp lệ');
  const note = draft.note.trim();
  return {
    bookingId,
    type: 'BALANCE',
    method: draft.method,
    amount: Number.parseInt(draft.amount.trim(), 10),
    ...(note === '' ? {} : { note }),
  };
}

export interface CheckOutDraft {
  readonly early: boolean;
  readonly note: string;
}

export interface CheckOutBody {
  bookingId: string;
  lateCheckOut: false;
  earlyCheckOut: boolean;
  note?: string;
}

/** `lateCheckOut` luôn `false`: máy chủ tự quyết phụ thu muộn theo giờ nghiệp vụ, không đọc cờ này. */
export function checkOutBody(bookingId: string, draft: CheckOutDraft): CheckOutBody {
  const note = draft.note.trim();
  return {
    bookingId,
    lateCheckOut: false,
    earlyCheckOut: draft.early,
    ...(note === '' ? {} : { note }),
  };
}

/** Lệnh 🔒 trả `401 E_AUTH_PIN_REQUIRED` khi PIN thiếu/hết hạn/đã dùng: nhập lại PIN, không phải thiếu quyền. */
export function isPinRequired(caught: unknown): boolean {
  return isApiError(caught) && caught.code === 'E_AUTH_PIN_REQUIRED';
}

export type StayFailure = ActionFailure | { readonly kind: 'pinRequired' };

export function stayFailure(caught: unknown): StayFailure {
  return isPinRequired(caught) ? { kind: 'pinRequired' } : actionFailure(caught);
}

/** Trả phòng bị từ chối vì còn số dư (máy chủ đã ghi nghĩa vụ): chuyển sang thu số dư (BR-FO-05). */
export function isUnsettled(failure: StayFailure): boolean {
  return failure.kind === 'rejected' && failure.code === 'E_PAY_AMOUNT_MISMATCH';
}

export type PinUnlockFailure =
  | { readonly kind: 'wrong' }
  | { readonly kind: 'locked'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'expired' }
  | { readonly kind: 'unavailable' };

export function pinUnlockFailure(caught: unknown): PinUnlockFailure {
  if (!isApiError(caught)) return { kind: 'unavailable' };
  if (caught.code === 'E_AUTH_PIN_LOCKED')
    return {
      kind: 'locked',
      retryAfterSeconds:
        typeof caught.retryAfterSeconds === 'number' ? caught.retryAfterSeconds : null,
    };
  if (caught.code === 'E_AUTH_PIN_REQUIRED' || caught.code === 'E_AUTH_INVALID_CREDENTIALS')
    return { kind: 'wrong' };
  return caught.status === 401 ? { kind: 'expired' } : { kind: 'unavailable' };
}

export type ReadFailure = 'offline' | 'expired' | 'forbidden' | 'error';

export function readFailure(error: unknown): ReadFailure {
  if (!isApiError(error)) return 'error';
  if (error.kind === 'network' || error.kind === 'aborted') return 'offline';
  if (error.status === 401) return 'expired';
  if (error.status === 403) return 'forbidden';
  return 'error';
}
