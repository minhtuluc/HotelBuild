/**
 * Hiển thị **ngày nghiệp vụ** (date-only, `YYYY-MM-DD` theo NFR-LOC-02) dưới dạng `dd/MM/yyyy`.
 *
 * Ngày nghiệp vụ không phải một thời điểm: KHÔNG dựng `Date`, KHÔNG áp múi giờ, KHÔNG đổi giá trị
 * gửi/nhận API. Chỉ cắt chuỗi nên kết quả giống nhau ở mọi TZ của máy chạy.
 */

const BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → `dd/MM/yyyy`; giá trị không đúng dạng thì giữ nguyên (không bịa ngày). */
export function formatBusinessDate(value: string): string {
  const parts = BUSINESS_DATE.exec(value);
  if (parts === null) return value;
  const [, year, month, day] = parts;
  return `${day}/${month}/${year}`;
}
