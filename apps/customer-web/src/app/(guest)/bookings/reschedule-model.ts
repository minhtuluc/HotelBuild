/**
 * Lớp thuần cho SCR-12 (đổi ngày lưu trú).
 *
 * Ghi chú hợp đồng (HB-104): `POST /bookings/{id}/reschedule` trả `bookingSummarySchema` — **không** có
 * trường chênh lệch giá hay phí đổi ngày. Vì vậy màn hình lấy giá kỳ mới bằng báo giá công khai
 * (`POST /quotes`) rồi hiện chênh lệch giữa hai con số **máy chủ** đã trả; phần "phí" không có trong hợp
 * đồng nên màn hình nói rõ máy chủ chưa trả trường này thay vì bịa số 0.
 */
import type { CustomerMessageKey } from '../../../lib/i18n';

/** Lỗi kiểm tra tại chỗ cho kỳ mới (máy chủ vẫn là nơi quyết định cuối cùng). */
export type StayIssue = 'MISSING' | 'ORDER' | 'RANGE';

export const STAY_ISSUE_KEYS: Readonly<Record<StayIssue, CustomerMessageKey>> = {
  MISSING: 'guest.reschedule.issue.missing',
  ORDER: 'guest.reschedule.issue.order',
  RANGE: 'guest.reschedule.issue.range',
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
