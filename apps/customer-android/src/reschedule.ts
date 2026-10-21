/**
 * SCR-82 (HB-114) — đổi ngày lưu trú trên Android: lớp thuần.
 *
 * Trình tự: nhập kỳ mới → **xem chênh lệch** (giá kỳ mới do `POST /quotes` của máy chủ trả, giá đang giữ
 * lấy từ `GET /bookings?q=`) → mới mở nút xác nhận → `POST /bookings/{id}/reschedule` kèm `quoteId`.
 *
 * Ghi chú hợp đồng: phản hồi đổi ngày là `bookingSummarySchema` — **không** có trường chênh lệch giá hay
 * phí đổi ngày. App **không** tự tính tiền (ADR-018): chênh lệch chỉ là hiệu của hai con số máy chủ trả,
 * còn phí thì nói rõ hợp đồng chưa có trường thay vì bịa số 0.
 */
import { isApiError } from '@pinehill/api-client';
import type { BookingSummary, Quote, QuoteRequest, RescheduleRequest } from '@pinehill/contracts';
import { OfflineError, requireOnline, type NetInfoSource } from './netinfo';
import { planCodeOf, quoteExpired, quoteRequest } from './room-detail';
import type { MessageKey } from './strings';

/** Lỗi kiểm tra tại chỗ cho kỳ mới (máy chủ vẫn là nơi quyết định cuối cùng). */
export type StayIssue = 'MISSING' | 'ORDER' | 'RANGE';

export const STAY_ISSUE_KEYS: Readonly<Record<StayIssue, MessageKey>> = {
  MISSING: 'booking.reschedule.issue.missing',
  ORDER: 'booking.reschedule.issue.order',
  RANGE: 'booking.reschedule.issue.range',
};

const DAY_MS = 86_400_000;

/** Số đêm giữa hai mốc ngày; `null` khi mốc không hợp lệ hoặc ngoài 1…365 đêm. */
export function nightsBetween(checkIn: string, checkOut: string): number | null {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const nights = (end - start) / DAY_MS;
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) return null;
  return nights;
}

export function stayIssue(checkIn: string, checkOut: string): StayIssue | null {
  if (checkIn === '' || checkOut === '') return 'MISSING';
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 'MISSING';
  if (end <= start) return 'ORDER';
  return nightsBetween(checkIn, checkOut) === null ? 'RANGE' : null;
}

/** Kỳ mới có trùng kỳ đang giữ? Trùng thì không cần đổi (chặn gửi lệnh vô nghĩa). */
export function isSameStay(
  current: { readonly checkIn: string; readonly checkOut: string },
  next: { readonly checkIn: string; readonly checkOut: string },
): boolean {
  return current.checkIn === next.checkIn && current.checkOut === next.checkOut;
}

export interface StayDifference {
  readonly kind: 'more' | 'less' | 'same';
  readonly amount: number;
}

/** Chênh lệch giữa giá kỳ mới và giá đang giữ — hiển thị, không dùng để tính tiền phải trả. */
export function stayDifference(newTotal: number, currentTotal: number): StayDifference {
  const delta = newTotal - currentTotal;
  if (delta === 0) return { kind: 'same', amount: 0 };
  return { kind: delta > 0 ? 'more' : 'less', amount: Math.abs(delta) };
}

/** Thân yêu cầu đổi ngày: `quoteId` là báo giá máy chủ đã trả cho kỳ mới (không tự tính lại). */
export function rescheduleRequestFor(input: {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly quoteId: string;
  readonly note: string;
}): RescheduleRequest {
  const reason = input.note.trim();
  return {
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    quoteId: input.quoteId,
    ...(reason === '' ? {} : { reason }),
  };
}

export type RescheduleStep = 'idle' | 'quoting' | 'quoted' | 'submitting' | 'done';

export interface RescheduleGate {
  readonly step: RescheduleStep;
  readonly online: boolean;
  readonly issue: StayIssue | null;
  readonly same: boolean;
  readonly quote: Quote | null;
  readonly nowMs: number;
}

export interface RescheduleActionStates {
  readonly quoteDisabled: boolean;
  readonly confirmDisabled: boolean;
  readonly quoteExpired: boolean;
}

/** Trạng thái hai nút suy từ bước + kết nối + báo giá; màn hình chỉ gắn vào `disabled`. */
export function actionStates(gate: RescheduleGate): RescheduleActionStates {
  const expired = gate.quote !== null && quoteExpired(gate.quote, gate.nowMs);
  const settled = gate.step === 'idle' || gate.step === 'quoted';
  return {
    quoteDisabled: !gate.online || !settled || gate.issue !== null || gate.same,
    confirmDisabled: !gate.online || gate.step !== 'quoted' || gate.quote === null || expired,
    quoteExpired: expired,
  };
}

/** Bề mặt API cần cho màn đổi ngày — tách ra để test không cần mạng. */
export interface RescheduleApi {
  quote(request: QuoteRequest): Promise<Quote>;
  reschedule(bookingId: string, request: RescheduleRequest): Promise<BookingSummary>;
}

export interface RescheduleDeps {
  readonly api: RescheduleApi;
  readonly net: NetInfoSource;
}

export type QuoteOutcome =
  | { readonly kind: 'offline' }
  | { readonly kind: 'invalidPlan' }
  | { readonly kind: 'ready'; readonly quote: Quote }
  | { readonly kind: 'failed'; readonly code: string | null };

/**
 * Báo giá kỳ mới của **chính** cơ sở/loại phòng/gói đang giữ. Gói chỉ có `ratePlanId`; báo giá cần
 * `ratePlanCode` nên chỉ nhận khi giá trị đó đúng là mã gói công bố (kiểm bằng schema, không đoán).
 */
export async function loadNewQuote(
  deps: RescheduleDeps,
  booking: BookingSummary,
  checkIn: string,
  checkOut: string,
): Promise<QuoteOutcome> {
  const planCode = planCodeOf(booking.ratePlanId);
  if (planCode === null) return { kind: 'invalidPlan' };
  try {
    await requireOnline(deps.net);
  } catch (caught) {
    if (caught instanceof OfflineError) return { kind: 'offline' };
    throw caught;
  }
  try {
    const quote = await deps.api.quote(
      quoteRequest(
        {
          propertyId: booking.propertyId,
          roomTypeId: booking.roomTypeId,
          checkIn,
          checkOut,
          adults: booking.adults,
          children: booking.children,
          roomCount: booking.roomCount,
        },
        planCode,
      ),
    );
    return { kind: 'ready', quote };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
}

export type RescheduleOutcome =
  | { readonly kind: 'offline' }
  | { readonly kind: 'done'; readonly booking: BookingSummary }
  | { readonly kind: 'failed'; readonly code: string | null };

/** Gửi lệnh đổi ngày: mất mạng thì dừng trước khi gọi máy chủ (không xác nhận thao tác tiền offline). */
export async function confirmReschedule(
  deps: RescheduleDeps,
  bookingId: string,
  request: RescheduleRequest,
): Promise<RescheduleOutcome> {
  try {
    await requireOnline(deps.net);
  } catch (caught) {
    if (caught instanceof OfflineError) return { kind: 'offline' };
    throw caught;
  }
  try {
    return { kind: 'done', booking: await deps.api.reschedule(bookingId, request) };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
}
