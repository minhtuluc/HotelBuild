/**
 * SCR-39 (đối soát ngày) & SCR-69 (trả phòng sớm) — HB-111: hàm thuần kiểm tra đầu vào và điều kiện gửi.
 */
import type {
  CheckOutPreview,
  CheckOutPreviewRequest,
  ReconciliationCloseRequest,
  ReconciliationCloseResponse,
} from '@pinehill/contracts';
import type { PinStep } from '../bookings/[bookingId]/collect/collect-model';

export type CashIssue = 'FORMAT';

/** Ngày nghiệp vụ mặc định theo múi giờ Việt Nam (YYYY-MM-DD). */
export function defaultBusinessDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Tiền mặt thực đếm là số nguyên VND không âm (BR-GEN-01, BR-PAY-06). */
export function cashIssue(countedCash: string): CashIssue | null {
  const trimmed = countedCash.trim();
  if (!/^\d+$/.test(trimmed)) return 'FORMAT';
  const value = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(value) && value >= 0 ? null : 'FORMAT';
}

/** Chỉ gửi lệnh chốt quỹ khi đã xác thực PIN, chọn cơ sở, ngày hợp lệ và tiền mặt hợp lệ. */
export function canCloseReconciliation(
  step: PinStep,
  issue: CashIssue | null,
  propertyId: string,
  businessDate: string,
): boolean {
  return (
    step === 'verified' &&
    issue === null &&
    propertyId.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(businessDate)
  );
}

export function reconciliationRequestOf(input: {
  readonly propertyId: string;
  readonly businessDate: string;
  readonly countedCash: string;
  readonly note: string;
}): ReconciliationCloseRequest {
  const note = input.note.trim();
  return {
    propertyId: input.propertyId,
    businessDate: input.businessDate,
    countedCash: Number.parseInt(input.countedCash.trim(), 10),
    ...(note === '' ? {} : { note }),
  };
}

/** Cảnh báo chênh lệch quỹ vượt ngưỡng hoặc đã báo quản lý (BR-PAY-10, UI-17). */
export function hasDiscrepancyWarning(
  result: Pick<ReconciliationCloseResponse, 'difference' | 'managerNotified'>,
): boolean {
  return result.managerNotified || Math.abs(result.difference) > 50_000;
}

export function earlyCheckoutPreviewRequestOf(
  bookingId: string,
  note: string,
): CheckOutPreviewRequest {
  const trimmed = note.trim();
  return {
    bookingId,
    lateCheckOut: false,
    earlyCheckOut: true,
    ...(trimmed === '' ? {} : { note: trimmed }),
  };
}

/** Xác nhận trả phòng sớm yêu cầu đã xem trước số tiền từ máy chủ và đã xác thực PIN. */
export function canConfirmEarlyCheckout(step: PinStep, preview: CheckOutPreview | null): boolean {
  return step === 'verified' && preview !== null;
}
