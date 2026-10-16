/**
 * `businessDate` là **ngày lịch** (date-only, `YYYY-MM-DD`), không phải mốc thời gian.
 * Hiển thị theo quy ước `dd/MM/yyyy` (NFR-LOC-02) bằng cách hoán vị chuỗi: không dựng
 * `Date`, không quy đổi múi giờ và không tự cộng giờ — giá trị gửi lên API giữ nguyên.
 */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatBusinessDate(businessDate: string): string {
  const match = CALENDAR_DATE.exec(businessDate);
  if (!match) throw new RangeError(`Ngày nghiệp vụ không hợp lệ: ${businessDate}`);
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}
