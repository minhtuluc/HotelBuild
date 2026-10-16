/**
 * Ngày **lịch** (date-only) của API hiển thị theo `dd/MM/yyyy`.
 *
 * Hoán vị thuần chuỗi ISO `YYYY-MM-DD` → `DD/MM/YYYY`: **không** dựng `Date`/múi giờ để giữ nguyên
 * ngày nghiệp vụ máy chủ trả. Dùng chung cho danh sách/chi tiết đơn (`orders.ts`) và màn xác nhận
 * giữ chỗ (`app/booking/confirm.tsx`).
 */
export function calendarDateLabel(value: string): string {
  return value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
}
