/**
 * SCR-04/05 — phần thuần: kiểm thông tin khách tại chỗ (theo `guestContactSchema`) và điều khoản huỷ
 * của gói hiển thị **trước khi xác nhận** (depositPercent/freeCancelHours của tuyến công khai).
 * Không suy diễn điều khoản nào ngoài dữ liệu hợp đồng trả.
 */
import { isApiError } from '@pinehill/api-client';
import { guestContactSchema } from '@pinehill/contracts';
import type { RatePlanPublic } from '@pinehill/contracts';

export interface FieldIssue {
  readonly field: string;
  readonly issue: string;
}

/** Số bước bắt buộc của journey khách tới xác nhận (AC1: ≤ 4). */
export const JOURNEY_STEPS: readonly string[] = ['find', 'results', 'detail', 'confirm'];

export interface GuestDraft {
  readonly fullName: string;
  readonly phone: string;
  readonly note: string;
}

export function guestIssues(draft: GuestDraft): readonly FieldIssue[] {
  const issues: FieldIssue[] = [];
  const parsed = guestContactSchema.safeParse({ fullName: draft.fullName, phone: draft.phone });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      issues.push({
        field: field === '' ? 'guest' : `guest.${field}`,
        issue: field === 'phone' ? 'NOT_PHONE' : 'REQUIRED',
      });
    }
  }
  return issues;
}

export interface PlanTerms {
  readonly depositPercent: number;
  /** Số giờ trước nhận phòng được huỷ miễn phí; `null` khi tuyến công khai không trả. */
  readonly freeCancelHours: number | null;
  readonly minNights: number;
  readonly maxNights: number;
}

/** Điều khoản gói hiển thị trước khi xác nhận — lấy nguyên từ `GET /rate-plans` công khai. */
export function planTerms(plan: RatePlanPublic): PlanTerms {
  return {
    depositPercent: plan.depositPercent,
    freeCancelHours: plan.freeCancelHours ?? null,
    minNights: plan.minNights,
    maxNights: plan.maxNights,
  };
}

/** Câu hỏi khi máy chủ nghi trùng booking: khách chọn mở booking cũ hay quay lại chỉnh thông tin. */
export function duplicateChoices(bookingId: string): { openHref: string; keepEditing: boolean } {
  return { openHref: `/booking/${encodeURIComponent(bookingId)}`, keepEditing: true };
}

/**
 * Go-live: `POST /bookings` cần phiên khách. Khách chưa đăng nhập nhận 401 ⇒ đưa sang đăng nhập rồi quay lại
 * đúng trang đặt (cùng tiêu chí), thay vì báo nhầm "không lấy được báo giá".
 */
export function loginRedirectFor(caught: unknown, query: string): string | null {
  if (!isApiError(caught) || caught.status !== 401) return null;
  return `/account/login?next=${encodeURIComponent(`/book?${query}`)}`;
}
