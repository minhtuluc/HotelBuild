/**
 * SCR-76 + SCR-78 (HB-087) — xác nhận & giữ chỗ trên Android.
 *
 * Hai bước rõ ràng, đều **cần phiên khách**: `POST /holds` (giữ chỗ có hạn, mốc `expiresAt` do máy chủ trả)
 * rồi `POST /bookings` (đặt phòng; nếu máy chủ nghi trùng thì hỏi khách thay vì tự tạo thêm). Đếm ngược
 * chỉ để hiển thị/khoá nút: app không tự tính hạn, và mọi con số tiền là nguyên văn máy chủ trả (ADR-018).
 */
import type {
  BookingCreateRequest,
  BookingSummary,
  Hold,
  HoldCreateRequest,
  RatePlanCode,
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

export function holdRequestFor(input: HoldInput): HoldCreateRequest {
  return {
    propertyId: input.criteria.propertyId,
    roomTypeId: input.criteria.roomTypeId,
    channelCode: GUEST_CHANNEL_CODE,
    checkIn: input.criteria.checkIn,
    checkOut: input.criteria.checkOut,
    adults: input.criteria.adults,
    children: input.criteria.children,
    roomCount: input.criteria.roomCount,
    quoteId: input.quoteId,
  };
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
  hold(request: HoldCreateRequest): Promise<Hold>;
  book(request: BookingCreateRequest): Promise<BookingSummary>;
}

export type HoldOutcome =
  | { readonly kind: 'offline' }
  | { readonly kind: 'ready'; readonly hold: Hold }
  | { readonly kind: 'failed'; readonly code: string | null };

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

/** Bước 1: giữ chỗ. Trả `expiresAt` của máy chủ để màn hình đếm ngược. */
export async function startHold(
  deps: { readonly api: HoldApi; readonly net: NetInfoSource },
  input: HoldInput,
): Promise<HoldOutcome> {
  if (!(await online(deps.net))) return { kind: 'offline' };
  try {
    return { kind: 'ready', hold: await deps.api.hold(holdRequestFor(input)) };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
}

/** Bước 2: đặt phòng trên chỗ đang giữ; máy chủ nghi trùng thì trả `duplicate` để hỏi khách. */
export async function finishBooking(
  deps: { readonly api: HoldApi; readonly net: NetInfoSource },
  input: HoldInput,
): Promise<BookingOutcome> {
  if (!(await online(deps.net))) return { kind: 'offline' };
  try {
    const booking = await deps.api.book(bookingRequestFor(input));
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

/** Số mili giây còn lại theo mốc `expiresAt` của máy chủ; `null` khi mốc không đọc được. */
export function holdRemaining(hold: Hold, nowMs: number): number | null {
  const expiry = Date.parse(hold.expiresAt);
  return Number.isNaN(expiry) ? null : Math.max(0, expiry - nowMs);
}

/** Nút "đặt phòng" chỉ mở khi chỗ giữ còn hạn (AC1: hết hạn thì khoá tiếp tục). */
export function continueEnabled(hold: Hold | null, nowMs: number): boolean {
  if (hold === null) return false;
  const remaining = holdRemaining(hold, nowMs);
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
