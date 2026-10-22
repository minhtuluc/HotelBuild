/**
 * SCR-65 (HB-157) — phần thuần của luồng tạo booking walk-in, kiểm bằng vitest.
 *
 * Ranh giới (ADR-018): màn hình chỉ kiểm **biểu mẫu** (đủ trường, ngày hợp lệ, số nguyên). Giá, tồn, cọc,
 * kênh WALKIN và nghi trùng do máy chủ quyết; mọi số tiền hiển thị là số máy chủ trả.
 */
import { isApiError, type ApiError } from '@pinehill/api-client';
import type { PaymentCreateRequest, WalkInRequest } from '@pinehill/contracts';

export const WALK_IN_STEPS = ['stay', 'guest', 'review', 'deposit', 'done'] as const;
export type WalkInStep = (typeof WALK_IN_STEPS)[number];

export const RATE_PLAN_CODES = ['FLEX7', 'SAVER3', 'NONREF', 'LONGSTAY14'] as const;
export type RatePlanCode = (typeof RATE_PLAN_CODES)[number];

export function stepNumber(step: WalkInStep): number {
  return WALK_IN_STEPS.indexOf(step) + 1;
}

export function nextStep(step: WalkInStep): WalkInStep {
  return WALK_IN_STEPS[Math.min(WALK_IN_STEPS.indexOf(step) + 1, WALK_IN_STEPS.length - 1)] ?? step;
}

export function previousStep(step: WalkInStep): WalkInStep {
  return WALK_IN_STEPS[Math.max(WALK_IN_STEPS.indexOf(step) - 1, 0)] ?? step;
}

/** `YYYY-MM-DD` hợp lệ và đúng là một ngày lịch. */
export function validBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}

/** Cộng ngày trên lịch (UTC thuần, không phụ thuộc múi giờ thiết bị). */
export function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export interface WalkInStay {
  propertyId: string;
  roomTypeId: string;
  ratePlanCode: RatePlanCode;
  checkIn: string;
  checkOut: string;
  adults: string;
  children: string;
  roomCount: string;
}

export interface WalkInGuest {
  fullName: string;
  phone: string;
}

export function walkInDefaults(propertyId: string, date: string): WalkInStay {
  return {
    propertyId,
    roomTypeId: '',
    ratePlanCode: 'FLEX7',
    checkIn: date,
    checkOut: addDays(date, 1),
    adults: '2',
    children: '0',
    roomCount: '1',
  };
}

function wholeInRange(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export type StayIssue = 'PROPERTY' | 'ROOM_TYPE' | 'DATES' | 'COUNTS';

function datesIssue(stay: WalkInStay): boolean {
  if (!validBusinessDate(stay.checkIn) || !validBusinessDate(stay.checkOut)) return true;
  return Date.parse(`${stay.checkOut}T00:00:00Z`) <= Date.parse(`${stay.checkIn}T00:00:00Z`);
}

function countsIssue(stay: WalkInStay): boolean {
  return (
    wholeInRange(stay.adults, 1, 20) === null ||
    wholeInRange(stay.children, 0, 20) === null ||
    wholeInRange(stay.roomCount, 1, 10) === null
  );
}

/** Kiểm biểu mẫu bước 1 (không phải kiểm tồn/giá — máy chủ quyết). */
export function stayIssue(stay: WalkInStay): StayIssue | null {
  if (stay.propertyId === '') return 'PROPERTY';
  if (stay.roomTypeId === '') return 'ROOM_TYPE';
  if (datesIssue(stay)) return 'DATES';
  return countsIssue(stay) ? 'COUNTS' : null;
}

export type GuestIssue = 'NAME' | 'PHONE';

export function guestIssue(guest: WalkInGuest): GuestIssue | null {
  const name = guest.fullName.trim();
  if (name === '' || name.length > 120) return 'NAME';
  return /^(?:\+84|0)\d{9}$/.test(guest.phone.trim()) ? null : 'PHONE';
}

/** Dựng đúng `walkInRequestSchema`: không có `channelCode` (kênh do cấu hình máy chủ quyết). */
export function toWalkInRequest(stay: WalkInStay, guest: WalkInGuest, note: string): WalkInRequest {
  const adults = wholeInRange(stay.adults, 1, 20);
  const children = wholeInRange(stay.children, 0, 20);
  const roomCount = wholeInRange(stay.roomCount, 1, 10);
  if (adults === null || children === null || roomCount === null)
    throw new RangeError('Invalid walk-in stay counts');
  const trimmed = note.trim();
  return {
    propertyId: stay.propertyId,
    roomTypeId: stay.roomTypeId,
    ratePlanCode: stay.ratePlanCode,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    adults,
    children,
    roomCount,
    guest: { fullName: guest.fullName.trim(), phone: guest.phone.trim() },
    ...(trimmed === '' ? {} : { note: trimmed }),
  };
}

export type DepositMethod = 'CASH' | 'BANK_TRANSFER';

/** Thu cọc: `amount` là số cọc máy chủ trả; `pinToken` dùng một lần; không có dữ liệu thẻ. */
export function depositBody(
  bookingId: string,
  method: DepositMethod,
  amount: number,
  pinToken: string,
): PaymentCreateRequest {
  return { bookingId, type: 'DEPOSIT', method, amount, pinToken };
}

export type ActionFailure =
  | {
      readonly kind: 'rejected';
      readonly code: string;
      readonly status: number | null;
      readonly reason: string;
    }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unknownOutcome'; readonly reference: string };

const CONFLICT_CODES: readonly string[] = [
  'E_GEN_VERSION_CONFLICT',
  'E_GEN_PRECONDITION_REQUIRED',
  'E_SYS_IDEMPOTENCY_KEY_REUSED',
];

function forbidden(caught: ApiError): boolean {
  return caught.code !== 'E_AUTH_PIN_REQUIRED' && (caught.status === 401 || caught.status === 403);
}

function versionConflict(caught: ApiError): boolean {
  return (
    caught.status === 412 ||
    caught.status === 428 ||
    (caught.code !== undefined && CONFLICT_CODES.includes(caught.code))
  );
}

function unclearOutcome(caught: ApiError): boolean {
  return (
    caught.kind === 'network' ||
    caught.kind === 'timeout' ||
    caught.kind === 'protocol' ||
    caught.kind === 'aborted' ||
    (caught.status ?? 0) >= 500
  );
}

/**
 * Phân loại lỗi lệnh ghi (design §8.1): 4xx nghiệp vụ → từ chối chắc chắn; 412/428/khoá tái dùng → xung đột;
 * 401/403 → thiếu quyền (trừ `E_AUTH_PIN_REQUIRED`, cho nhập PIN lại); mất mạng/hết giờ/5xx → chưa xác định.
 */
export function actionFailure(caught: unknown): ActionFailure {
  if (!isApiError(caught)) return { kind: 'unknownOutcome', reference: '—' };
  if (forbidden(caught)) return { kind: 'forbidden' };
  if (versionConflict(caught)) return { kind: 'conflict' };
  if (unclearOutcome(caught))
    return { kind: 'unknownOutcome', reference: caught.traceId ?? caught.correlationId ?? '—' };
  return {
    kind: 'rejected',
    code: caught.code ?? String(caught.status ?? 'UNKNOWN'),
    status: caught.status ?? null,
    reason: caught.message,
  };
}

export type PinFailure =
  | { readonly kind: 'wrong' }
  | { readonly kind: 'locked'; readonly minutes: number | null }
  | { readonly kind: 'unavailable' };

export function pinFailure(caught: unknown): PinFailure {
  if (!isApiError(caught)) return { kind: 'unavailable' };
  if (caught.code === 'E_AUTH_PIN_LOCKED')
    return {
      kind: 'locked',
      minutes:
        typeof caught.retryAfterSeconds === 'number'
          ? Math.ceil(caught.retryAfterSeconds / 60)
          : null,
    };
  if (caught.code === 'E_AUTH_PIN_REQUIRED' || caught.code === 'E_AUTH_INVALID_CREDENTIALS')
    return { kind: 'wrong' };
  return { kind: 'unavailable' };
}
