/**
 * Lớp thuần cho SCR-11 (huỷ đặt phòng & tiền hoàn).
 *
 * Nguyên tắc: giao diện **không** tính tiền hay luật chính sách (ADR-018) — mọi con số đến từ
 * `POST /bookings/{id}/cancel-preview`. Màn hình chỉ lo hai việc: giữ đúng trình tự "xem trước rồi mới
 * xác nhận", và buộc xem trước lại khi số liệu máy chủ trả đã khác lần xem trước đang hiển thị.
 */
import type { CancelPreview } from '@pinehill/contracts';

export type CancellationBreakdown = CancelPreview['cancellation'];
import type { CustomerMessageKey } from '../../../lib/i18n';

/** Lý do khách được phép khai trên web khách (máy chủ vẫn kiểm quyền theo từng lý do). */
export type CancelReason = 'GUEST_REQUEST' | 'FORCE_MAJEURE';

export const CANCEL_REASONS: readonly CancelReason[] = ['GUEST_REQUEST', 'FORCE_MAJEURE'];

export const CANCEL_REASON_KEYS: Readonly<Record<CancelReason, CustomerMessageKey>> = {
  GUEST_REQUEST: 'guest.cancel.reason.guestRequest',
  FORCE_MAJEURE: 'guest.cancel.reason.forceMajeure',
};

/** Cờ bất khả kháng gửi kèm chỉ khi khách khai đúng lý do đó. */
export function claimsForceMajeure(reason: CancelReason): boolean {
  return reason === 'FORCE_MAJEURE';
}

/** Bước của luồng huỷ; nút xác nhận chỉ mở khi đã **có** kết quả xem trước. */
export type CancelStep = 'idle' | 'computing' | 'previewed' | 'submitting' | 'done';

export function canConfirm(step: CancelStep): boolean {
  return step === 'previewed';
}

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

/** Số giờ trước giờ nhận phòng tại lúc xem trước (máy chủ tính), hiển thị một chữ số thập phân. */
export function formatHoursBeforeCheckIn(hours: number): string {
  return hours.toFixed(1);
}
