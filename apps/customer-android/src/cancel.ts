/**
 * SCR-81 (HB-114) — huỷ đặt phòng & số tiền hoàn trên Android: lớp thuần.
 *
 * Nguyên tắc: giao diện **không** tính tiền hay luật chính sách (ADR-018) — mọi con số đến từ
 * `POST /bookings/{id}/cancel-preview`. Màn hình chỉ lo hai việc: giữ đúng trình tự "xem trước rồi mới
 * xác nhận", và buộc xem trước lại khi số liệu máy chủ trả đã khác lần xem trước đang hiển thị.
 * Mất mạng thì **không** xác nhận được thao tác tiền (QĐ-03 quyết định 6); bản xem trước đã có chỉ để đọc.
 */
import { isApiError } from '@pinehill/api-client';
import type {
  CancelPreview,
  CancelPreviewRequest,
  CancelRequest,
  CancelResponse,
} from '@pinehill/contracts';
import { OfflineError, requireOnline, type NetInfoSource } from './netinfo';
import type { MessageKey } from './strings';

/** Lý do khách được phép khai trên app (máy chủ vẫn kiểm quyền theo từng lý do). */
export type CancelReason = 'GUEST_REQUEST' | 'FORCE_MAJEURE';

export const CANCEL_REASONS: readonly CancelReason[] = ['GUEST_REQUEST', 'FORCE_MAJEURE'];

export const CANCEL_REASON_KEYS: Readonly<Record<CancelReason, MessageKey>> = {
  GUEST_REQUEST: 'booking.cancel.reason.guestRequest',
  FORCE_MAJEURE: 'booking.cancel.reason.forceMajeure',
};

/** Cờ bất khả kháng gửi kèm chỉ khi khách khai đúng lý do đó. */
export function cancelRequestFor(reason: CancelReason): CancelPreviewRequest {
  return { reason, isForceMajeure: reason === 'FORCE_MAJEURE' };
}

/** Bước của luồng huỷ; nút xác nhận chỉ mở khi đã **có** kết quả xem trước và đang online. */
export type CancelStep = 'idle' | 'computing' | 'previewed' | 'submitting' | 'done';

export function canPreview(step: CancelStep, online: boolean): boolean {
  return online && (step === 'idle' || step === 'previewed');
}

export function canConfirm(step: CancelStep, online: boolean): boolean {
  return online && step === 'previewed';
}

export interface CancelActionStates {
  readonly previewDisabled: boolean;
  readonly confirmDisabled: boolean;
}

/** Trạng thái nút suy từ bước + kết nối — màn hình chỉ việc gắn vào `disabled`/`accessibilityState`. */
export function actionStates(step: CancelStep, online: boolean): CancelActionStates {
  return { previewDisabled: !canPreview(step, online), confirmDisabled: !canConfirm(step, online) };
}

export type CancellationBreakdown = CancelPreview['cancellation'];

/** Máy chủ trả cùng một bộ số liệu? Khác ⇒ mốc/version đã đổi, phải xem trước lại. */
export function sameBreakdown(a: CancellationBreakdown, b: CancellationBreakdown): boolean {
  return (
    a.policyId === b.policyId &&
    a.appliedTierId === b.appliedTierId &&
    a.hoursBeforeCheckIn === b.hoursBeforeCheckIn &&
    a.refundPercent === b.refundPercent &&
    a.paidAmount === b.paidAmount &&
    a.requestedAmount === b.requestedAmount &&
    a.penaltyAmount === b.penaltyAmount &&
    a.refundFee === b.refundFee
  );
}

export function samePreview(a: CancelPreview, b: CancelPreview): boolean {
  return a.bookingId === b.bookingId && sameBreakdown(a.cancellation, b.cancellation);
}

export interface RefundRow {
  readonly key: 'paid' | 'requested' | 'penalty' | 'fee';
  readonly amount: number;
}

/** Bốn dòng tiền của một lần huỷ — luôn hiện đủ để khách đối chiếu, kể cả khi bằng 0. */
export function refundRows(breakdown: CancellationBreakdown): readonly RefundRow[] {
  return [
    { key: 'paid', amount: breakdown.paidAmount },
    { key: 'requested', amount: breakdown.requestedAmount },
    { key: 'penalty', amount: breakdown.penaltyAmount },
    { key: 'fee', amount: breakdown.refundFee },
  ];
}

/**
 * Số giờ trước giờ nhận phòng tại lúc xem trước (máy chủ tính), hiển thị một chữ số thập phân theo quy
 * ước `vi-VN` (dấu phẩy thập phân — NFR-LOC-02). Đây là số giờ, không phải tiền.
 */
const HOURS_FORMATTER = new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatHoursBeforeCheckIn(hours: number): string {
  return HOURS_FORMATTER.format(hours);
}

/** Bề mặt API cần cho màn huỷ — tách ra để test không cần mạng. */
export interface CancelApi {
  preview(bookingId: string, request: CancelPreviewRequest): Promise<CancelPreview>;
  cancel(bookingId: string, request: CancelRequest): Promise<CancelResponse>;
}

export interface CancelDeps {
  readonly api: CancelApi;
  readonly net: NetInfoSource;
}

export type PreviewOutcome =
  | { readonly kind: 'offline' }
  | { readonly kind: 'preview'; readonly preview: CancelPreview }
  | { readonly kind: 'failed'; readonly code: string | null };

/** Xem trước: offline thì không gọi máy chủ (chỉ còn bản đã có để đọc). */
export async function loadPreview(
  deps: CancelDeps,
  bookingId: string,
  request: CancelPreviewRequest,
): Promise<PreviewOutcome> {
  try {
    await requireOnline(deps.net);
  } catch (caught) {
    if (caught instanceof OfflineError) return { kind: 'offline' };
    throw caught;
  }
  try {
    return { kind: 'preview', preview: await deps.api.preview(bookingId, request) };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
}

export type ConfirmOutcome =
  | { readonly kind: 'offline' }
  | { readonly kind: 'stale'; readonly preview: CancelPreview }
  | { readonly kind: 'cancelled'; readonly result: CancelResponse }
  | { readonly kind: 'failed'; readonly code: string | null };

/**
 * Xác nhận: đối chiếu lại với máy chủ ngay trước khi huỷ. Số liệu đổi (qua mốc/version) thì **không**
 * huỷ mà trả bản mới để khách xác nhận lần nữa. Offline thì dừng trước khi gọi máy chủ.
 */
export async function confirmCancel(
  deps: CancelDeps,
  bookingId: string,
  request: CancelPreviewRequest,
  preview: CancelPreview,
  note: string,
): Promise<ConfirmOutcome> {
  const fresh = await loadPreview(deps, bookingId, request);
  if (fresh.kind !== 'preview') return fresh;
  if (!samePreview(fresh.preview, preview)) return { kind: 'stale', preview: fresh.preview };
  const trimmed = note.trim();
  try {
    const result = await deps.api.cancel(bookingId, {
      ...request,
      ...(trimmed === '' ? {} : { note: trimmed }),
    });
    return { kind: 'cancelled', result };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
}
