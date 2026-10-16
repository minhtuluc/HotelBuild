/**
 * Che thông tin người nhận trước khi rời máy chủ (api.md §2.11, NFR-SEC-03).
 *
 * Một chỗ duy nhất quyết định cách che — client không tự che, danh sách không bao giờ trả
 * `recipient` thô. Quy tắc:
 * - Chuỗi dạng email `local@domain` → giữ đúng ký tự đầu của phần local + `***` + giữ nguyên
 *   domain (`n***@gmail.com`), khớp ví dụ `a***@example.com` trong test hợp đồng HB-160.
 * - Còn lại (SĐT/Zalo/Push) → giữ 4 ký tự cuối, phần trước thay bằng `****` — cùng quy ước
 *   `maskString` của AuditWriter (HB-009) nên nhật ký kiểm toán và danh sách hiển thị khớp nhau.
 * Chuỗi quá ngắn/rỗng ⇒ `****` (hợp đồng yêu cầu `recipientMasked` tối thiểu 1 ký tự).
 */

const EMAIL_SHAPE = /^([^@\s]+)@([^@\s]+)$/;

export function maskRecipient(recipient: string): string {
  const value = recipient.trim();
  const email = EMAIL_SHAPE.exec(value);
  if (email !== null) return `${email[1]!.slice(0, 1)}***@${email[2]!}`;
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}
