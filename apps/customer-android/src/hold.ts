/**
 * SCR-76 + SCR-78 (HB-087) — xác nhận & giữ chỗ trên Android.
 *
 * Một lệnh **cần phiên khách**, giống customer web: xin báo giá trong phiên rồi `POST /bookings`. Máy chủ
 * tự giữ chỗ (HELD + `holdExpiresAt`); nếu nghi trùng thì hỏi khách thay vì tự tạo thêm. HB-253: không gọi
 * `POST /holds` — booking do tuyến đó tạo không có snapshot giá/nghĩa vụ phòng nên không đọc được số dư và
 * không thanh toán được. Đếm ngược chỉ để hiển thị/khoá nút; mọi con số tiền là nguyên văn máy chủ trả (ADR-018).
 */
import type {
  BookingCreateRequest,
  BookingSummary,
  RatePlanCode,
  QuoteRequest,
} from '@pinehill/contracts';
import { isApiError } from '@pinehill/api-client';
import { OfflineError, requireOnline, type NetInfoSource } from './netinfo';

/** Kênh đặt của app khách (api.md §6.3). */
export const GUEST_CHANNEL_CODE = 'WEB';

export interface HoldCriteria {
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly roomCount: number;
}

export interface GuestContact {
  readonly fullName: string;
  readonly phone: string;
}

export interface HoldInput {
  readonly criteria: HoldCriteria;
  /** Gói giá khách đã chọn ở SCR-74/75 — không tự mặc định ở đây. */
  readonly ratePlanCode: RatePlanCode;
  readonly quoteId: string;
  readonly guest: GuestContact;
  readonly note?: string;
}

export function bookingRequestFor(input: HoldInput): BookingCreateRequest {
  return {
    propertyId: input.criteria.propertyId,
    roomTypeId: input.criteria.roomTypeId,
    channelCode: GUEST_CHANNEL_CODE,
    ratePlanCode: input.ratePlanCode,
    quoteId: input.quoteId,
    guest: { fullName: input.guest.fullName.trim(), phone: input.guest.phone.trim() },
    checkIn: input.criteria.checkIn,
    checkOut: input.criteria.checkOut,
    adults: input.criteria.adults,
    children: input.criteria.children,
    roomCount: input.criteria.roomCount,
    ...(input.note === undefined || input.note.trim() === '' ? {} : { note: input.note.trim() }),
  };
}

/** Bề mặt API cần cho luồng này — tách ra để test không cần mạng. */
export interface HoldApi {
  /** HB-249: báo giá trong phiên của khách — API chỉ cho chính chủ thể tiêu thụ báo giá. */
  quote(request: QuoteRequest): Promise<{ readonly quoteId: string }>;
  book(request: BookingCreateRequest): Promise<BookingSummary>;
}

export type BookingOutcome =
  | { readonly kind: 'offline' }
  | { readonly kind: 'ready'; readonly booking: BookingSummary }
  | { readonly kind: 'duplicate'; readonly booking: BookingSummary }
  | { readonly kind: 'failed'; readonly code: string | null };

async function online(net: NetInfoSource): Promise<boolean> {
  try {
    await requireOnline(net);
    return true;
  } catch (caught) {
    if (caught instanceof OfflineError) return false;
    throw caught;
  }
}

/** Thân `POST /quotes` cho cùng kỳ/gói/khách — dùng để xin lại giá trong phiên trước khi giữ chỗ. */
export function quoteRequestFor(input: HoldInput): QuoteRequest {
  return {
    propertyId: input.criteria.propertyId,
    roomTypeId: input.criteria.roomTypeId,
    channelCode: GUEST_CHANNEL_CODE,
    ratePlanCode: input.ratePlanCode,
    checkIn: input.criteria.checkIn,
    checkOut: input.criteria.checkOut,
    adults: input.criteria.adults,
    children: input.criteria.children,
    roomCount: input.criteria.roomCount,
  };
}

/**
 * Xin lại báo giá trong phiên của khách (báo giá ở màn chi tiết phòng là của khách ẩn danh — API trả 409
 * `E_RATE_QUOTE_MISMATCH` nếu dùng thẳng, HB-249) rồi đặt phòng bằng mã báo giá đó. Máy chủ nghi trùng
 * thì trả `duplicate` để hỏi khách.
 */
export async function placeBooking(
  deps: { readonly api: HoldApi; readonly net: NetInfoSource },
  input: HoldInput,
): Promise<BookingOutcome> {
  if (!(await online(deps.net))) return { kind: 'offline' };
  try {
    const { quoteId } = await deps.api.quote(quoteRequestFor(input));
    const booking = await deps.api.book(bookingRequestFor({ ...input, quoteId }));
    return booking.duplicateSuspected ? { kind: 'duplicate', booking } : { kind: 'ready', booking };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
}

export interface BookingResult {
  readonly offline: boolean;
  readonly failedCode: string | null;
  readonly booking: BookingSummary | null;
  readonly duplicate: boolean;
}

/** Một chỗ duy nhất suy kết quả bước đặt phòng để màn hình không rải điều kiện. */
export function bookingResult(outcome: BookingOutcome): BookingResult {
  if (outcome.kind === 'offline')
    return { offline: true, failedCode: null, booking: null, duplicate: false };
  if (outcome.kind === 'failed')
    return {
      offline: false,
      failedCode: outcome.code ?? 'UNKNOWN',
      booking: null,
      duplicate: false,
    };
  return {
    offline: false,
    failedCode: null,
    booking: outcome.booking,
    duplicate: outcome.kind === 'duplicate',
  };
}

/** Số mili giây còn lại theo mốc giữ chỗ của máy chủ; `null` khi mốc không đọc được. */
export function holdRemaining(expiresAt: string, nowMs: number): number | null {
  const expiry = Date.parse(expiresAt);
  return Number.isNaN(expiry) ? null : Math.max(0, expiry - nowMs);
}

/** Nút tiếp tục chỉ mở khi booking còn trong hạn giữ (AC1); kênh không giữ chỗ thì không có hạn. */
export function continueEnabled(booking: BookingSummary | null, nowMs: number): boolean {
  if (booking === null) return false;
  if (booking.holdExpiresAt === null) return true;
  const remaining = holdRemaining(booking.holdExpiresAt, nowMs);
  return remaining !== null && remaining > 0;
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

/** Khách nhập đủ họ tên và SĐT theo định dạng Việt Nam (máy chủ vẫn kiểm lại). */
export function guestIssue(guest: GuestContact): 'NAME' | 'PHONE' | null {
  if (guest.fullName.trim() === '') return 'NAME';
  const phone = guest.phone.replace(/\s/g, '');
  return /^(?:\+84|0)\d{9}$/.test(phone) ? null : 'PHONE';
}
