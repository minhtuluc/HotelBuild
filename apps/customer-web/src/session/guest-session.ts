'use client';

/**
 * Phiên khách dùng chung trong một trang cho khu `/account` (SCR-08): một `SessionClient` duy nhất để
 * đầu trang và các biểu mẫu thấy cùng trạng thái đăng nhập, không tạo nhiều bộ điều phối cùng làm mới.
 * Token chỉ nằm trong bộ nhớ trình duyệt (cookie refresh là httpOnly do BFF giữ); module này không lưu
 * hay ghi log token. Cố ý **không** phát sự kiện `session-expired` toàn cục: khách ẩn danh là trạng thái
 * bình thường của khu này, không phải phiên hết hạn.
 */
import { createSessionClient } from '@pinehill/web-session/client';

type SessionClient = ReturnType<typeof createSessionClient>;
type Listener = (signedIn: boolean) => void;

const listeners = new Set<Listener>();
let client: SessionClient | undefined;

export function guestSession(): SessionClient {
  client ??= createSessionClient({
    kind: 'guest',
    onExpired: () => undefined,
    onSessionChanged: (accessToken) => {
      for (const listener of listeners) listener(accessToken !== null);
    },
  });
  return client;
}

/** Nhận mọi thay đổi trạng thái đăng nhập (đăng nhập, đăng xuất, hết phiên ở tab khác). */
export function subscribeSignedIn(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `true` khi còn phiên hợp lệ (làm mới bằng cookie nếu cần); lỗi hạ tầng coi như chưa đăng nhập. */
export async function isSignedIn(): Promise<boolean> {
  try {
    return (await guestSession().getAccessToken()) !== null;
  } catch {
    return false;
  }
}
