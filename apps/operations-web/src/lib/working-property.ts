/**
 * Chọn cơ sở cho một màn (TD-44, HB-314): cơ sở người dùng vừa chọn trên màn > cơ sở đang làm việc của
 * phiên (thanh ngữ cảnh) nếu có trong danh sách máy chủ trả > cơ sở đầu danh sách. Không nhận id ngoài
 * danh sách: phạm vi cơ sở do máy chủ quyết, giao diện không tự mở rộng.
 */
export function chooseProperty(
  available: readonly { readonly id: string }[],
  requested: string,
  preferred: string | null | undefined,
): string {
  if (requested !== '' && available.some((item) => item.id === requested)) return requested;
  if (preferred && available.some((item) => item.id === preferred)) return preferred;
  return available[0]?.id ?? '';
}
