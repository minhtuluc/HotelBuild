/**
 * SCR-35 + SCR-36 (HB-108) — sửa/đổi ngày/huỷ booking cho back-office: phần thuần, kiểm bằng vitest.
 *
 * Huỷ đi **hai bước bắt buộc**: xem trước số tiền hoàn (`POST .../cancel-preview`) rồi mới xác nhận
 * (`POST .../cancel`). Ngay trước khi huỷ, màn hình **đối chiếu lại** với máy chủ: số liệu đổi thì không
 * huỷ mà hiện số mới để lễ tân xác nhận lần nữa. Giao diện **không** tự tính tiền/luật chính sách (ADR-018):
 * bậc và số tiền là nguyên văn máy chủ trả; thang bậc chỉ để **hiển thị** cho lễ tân giải thích (§4.6).
 */
import type { OperationsMessageKey } from '../../../../../lib/i18n';
import type {
  BookingSummary,
  CancelPreview,
  CancelPreviewRequest,
  CancelRequest,
  CancellationPolicy,
  QuoteRequest,
  RatePlanCode,
} from '@pinehill/contracts';

export type CancellationBreakdown = CancelPreview['cancellation'];

export type CancelStep = 'choose' | 'computing' | 'previewed' | 'submitting' | 'done';

/** Chỉ mở nút xác nhận khi đã có bản xem trước (AC1: "xác nhận hai bước"). */
export function canConfirmCancel(step: CancelStep): boolean {
  return step === 'previewed';
}

/**
 * Lý do lễ tân được chọn ở SCR-36. Bốn giá trị còn lại của enum là luồng khác (`NO_SHOW` ở quầy tiếp
 * tân, `EARLY_CHECKOUT` ở trả phòng sớm, `SYSTEM`/`OTA_CANCELLATION` do hệ thống/kênh) nên không đưa vào.
 */
export const CANCEL_REASONS = [
  'GUEST_REQUEST',
  'FORCE_MAJEURE',
  'HOTEL_RELOCATION',
  'PAYMENT_TIMEOUT',
  'DUPLICATE',
] as const;

export type CancelReasonChoice = (typeof CANCEL_REASONS)[number];

export const CANCEL_REASON_KEYS: Readonly<Record<CancelReasonChoice, OperationsMessageKey>> = {
  GUEST_REQUEST: 'ops.cancel.reason.GUEST_REQUEST',
  FORCE_MAJEURE: 'ops.cancel.reason.FORCE_MAJEURE',
  HOTEL_RELOCATION: 'ops.cancel.reason.HOTEL_RELOCATION',
  PAYMENT_TIMEOUT: 'ops.cancel.reason.PAYMENT_TIMEOUT',
  DUPLICATE: 'ops.cancel.reason.DUPLICATE',
};

export interface CancelDraft {
  readonly reason: CancelReasonChoice;
  readonly note: string;
  readonly isForceMajeure: boolean;
  /** Tham chiếu chứng cứ cho bất khả kháng (tuỳ chọn, mỗi dòng một mã). */
  readonly evidence: string;
}

export const EMPTY_CANCEL_DRAFT: CancelDraft = {
  reason: 'GUEST_REQUEST',
  note: '',
  isForceMajeure: false,
  evidence: '',
};

function trimmed(value: string): string | undefined {
  const text = value.trim();
  return text === '' ? undefined : text;
}

export function previewRequestOf(draft: CancelDraft): CancelPreviewRequest {
  return { reason: draft.reason, isForceMajeure: draft.isForceMajeure };
}

export function cancelRequestOf(draft: CancelDraft): CancelRequest {
  const note = trimmed(draft.note);
  const evidence = draft.evidence
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return {
    reason: draft.reason,
    isForceMajeure: draft.isForceMajeure,
    ...(note === undefined ? {} : { note }),
    ...(evidence.length === 0 ? {} : { evidenceRefs: evidence }),
  };
}

/** Máy chủ trả cùng một bộ số liệu? Khác ⇒ mốc/version đã đổi, phải xem trước lại (AC1). */
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

/** Bốn dòng tiền của một lần huỷ — luôn hiện đủ để lễ tân đọc cho khách, kể cả khi bằng 0. */
export function refundRows(breakdown: CancellationBreakdown): readonly RefundRow[] {
  return [
    { key: 'paid', amount: breakdown.paidAmount },
    { key: 'requested', amount: breakdown.requestedAmount },
    { key: 'penalty', amount: breakdown.penaltyAmount },
    { key: 'fee', amount: breakdown.refundFee },
  ];
}

/**
 * Thang bậc của chính sách để hiển thị (§4.6): đánh dấu bậc **đang áp dụng** khi số giờ máy chủ trả khớp
 * đúng một bậc; không khớp thì không khoanh bậc nào (không tự suy luật).
 */
export function ladderRows(
  policy: CancellationPolicy,
  hoursBeforeCheckIn: number,
): readonly {
  readonly hours: number;
  readonly percent: number;
  readonly label: string | null;
  readonly applied: boolean;
}[] {
  return policy.tiers.map((tier) => ({
    hours: tier.hoursBeforeCheckIn,
    percent: tier.refundPercent,
    label: tier.label ?? null,
    applied: tier.hoursBeforeCheckIn === hoursBeforeCheckIn,
  }));
}

export const PARTIAL_CANCEL_SUPPORTED = false;

/** Chênh lệch giá khi đổi ngày: hiệu hai số máy chủ trả (không phải tiền phải trả). */
export function stayDifference(
  newTotal: number,
  currentTotal: number,
): {
  readonly kind: 'more' | 'less' | 'same';
  readonly amount: number;
} {
  const delta = newTotal - currentTotal;
  if (delta === 0) return { kind: 'same', amount: 0 };
  return { kind: delta > 0 ? 'more' : 'less', amount: Math.abs(delta) };
}

export function rescheduleRequestOf(
  checkIn: string,
  checkOut: string,
  quoteId: string,
  reason: string,
): {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly quoteId: string;
  readonly reason?: string;
} {
  const note = reason.trim();
  return { checkIn, checkOut, quoteId, ...(note === '' ? {} : { reason: note }) };
}

export function quoteRequestOf(
  booking: BookingSummary,
  ratePlanCode: RatePlanCode,
  checkIn: string,
  checkOut: string,
): QuoteRequest {
  return {
    propertyId: booking.propertyId,
    roomTypeId: booking.roomTypeId,
    channelCode: 'WEB',
    ratePlanCode,
    checkIn,
    checkOut,
    adults: booking.adults,
    children: booking.children,
    roomCount: booking.roomCount,
  };
}
