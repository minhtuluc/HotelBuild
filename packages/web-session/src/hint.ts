/**
 * Cookie gợi ý "có thể đã đăng nhập" của khách (HB-324, TD-42), tách riêng để trang chỉ cần đọc gợi ý
 * (header) không kéo client phiên, `api-client` hay schema hợp đồng vào bundle (HB-325). Không import gì.
 */
export const GUEST_SIGNED_HINT = 'pinehill_guest_signed';

/**
 * Có cookie gợi ý không. `false` thì trang khỏi gọi làm mới phiên; `true` chỉ là gợi ý, trạng thái thật vẫn
 * phải hỏi BFF. Gọi được cả khi dựng ở máy chủ (trả `false`).
 */
export function guestSignedHint(cookie?: string): boolean {
  const source = cookie ?? (typeof document === 'undefined' ? '' : document.cookie);
  return source.split(';').some((part) => part.trim() === `${GUEST_SIGNED_HINT}=1`);
}
