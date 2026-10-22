'use client';

/**
 * Cổng đăng nhập/đăng xuất của operations web trên BFF cookie (HB-019, QĐ-03 quyết định 1): bearer chỉ ở
 * bộ nhớ, refresh bằng cookie `HttpOnly` của chính app. Bọc `createSessionClient` để làm hai việc nó
 * không làm: (1) trả lỗi đăng nhập đã **phân loại** và (2) lấy `Retry-After` của BFF — client phiên chỉ giữ
 * `status`/`code` nên thời gian chờ của khoá tài khoản/giới hạn tần suất sẽ mất nếu không chặn ở `fetch`.
 */
import { createSessionClient } from '@pinehill/web-session/client';
import { loginFailure, type LoginFailure } from './login-model';

export class StaffLoginError extends Error {
  constructor(readonly failure: LoginFailure) {
    super('Đăng nhập không thành công.');
    this.name = 'StaffLoginError';
  }
}

export interface StaffAuthOptions {
  /** Gọi một lần khi phiên hết hiệu lực (refresh thất bại hoặc phiên bị thu hồi ở tab khác). */
  onExpired?: () => void;
  fetchImpl?: typeof fetch;
}

export interface StaffAuth {
  login(username: string, password: string): Promise<{ mustChangePassword: boolean }>;
  /** Thu hồi phiên ở máy chủ rồi xoá phiên cục bộ; lỗi mạng/máy chủ không làm phiên cục bộ còn lại. */
  logout(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  dispose(): void;
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  return Number.parseInt(raw, 10);
}

export function createStaffAuth(options: StaffAuthOptions = {}): StaffAuth {
  let lastRetryAfter: number | undefined;
  const base = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const client = createSessionClient({
    kind: 'staff',
    ...(options.onExpired === undefined ? {} : { onExpired: options.onExpired }),
    fetchImpl: async (input, init) => {
      lastRetryAfter = undefined;
      const response = await base(input, init);
      lastRetryAfter = retryAfterSeconds(response);
      return response;
    },
  });
  return {
    login: async (username, password) => {
      try {
        const session = await client.login({ username: username.trim(), password });
        return { mustChangePassword: session.mustChangePassword };
      } catch (caught) {
        throw new StaffLoginError(loginFailure(caught, lastRetryAfter));
      }
    },
    logout: async () => {
      try {
        await client.logout();
      } catch {
        // Mục tiêu là phiên cục bộ không còn dùng được; BFF đã xoá cookie, token còn lại hết hạn theo TTL.
      }
    },
    getAccessToken: () => client.getAccessToken(),
    dispose: () => {
      client.dispose();
    },
  };
}
