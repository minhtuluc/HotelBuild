import type { BookingStatus } from '@pinehill/contracts';

/**
 * BR-CRM-02 + BR-CRM-06 — số đêm xét hạng của **12 tháng gần nhất** chỉ tính booking **đã ở thực tế**:
 * booking bị huỷ, no-show hoặc chưa tới lượt lưu trú không cộng đêm.
 */
export const countedStayStatuses = [
  'CHECKED_IN',
  'CHECKED_OUT',
] as const satisfies readonly BookingStatus[];

/**
 * Mốc bắt đầu cửa sổ 12 tháng dưới dạng ngày lịch `YYYY-MM-DD` (lùi đúng 12 tháng, kẹp ngày khi tháng
 * đích ngắn hơn — ví dụ 31/3 → 28/2). Trả **chuỗi ngày** để so trực tiếp với cột `bookings.check_in`
 * kiểu `date` (`::date`), không phụ thuộc múi giờ phiên CSDL; `now` lấy từ `Clock` tiêm vào.
 */
export function windowStartDate(now: Date): string {
  const day = now.getUTCDate();
  const shifted = new Date(now.getTime());
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() - 12);
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted.toISOString().slice(0, 10);
}
