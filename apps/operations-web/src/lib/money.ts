/**
 * Nhập tiền ở tầng giao diện (BR-GEN-01): **chỉ** số nguyên dương VND, không dùng số thực.
 * Dùng chung cho các biểu mẫu F2/F3; trả `null` khi để trống hoặc không phải số nguyên dương.
 */
export function toMoney(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
