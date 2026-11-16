/**
 * Lệnh tài khoản khách từ trình duyệt (HB-324, TD-41): ba lệnh công khai qua `/api/session/*` cùng origin,
 * và cookie gợi ý đăng nhập. Lỗi chuẩn hoá thành `ApiError` (giữ `code`, `retryAfterSeconds`); mất mạng
 * hoặc hết giờ là `network`/`timeout`, tức **chưa xác định kết quả**, không phải thất bại chắc chắn.
 * Không ghi log thân lệnh (mật khẩu, token).
 */
import { ApiError } from '@pinehill/api-client';
import type { GuestRegisterRequest } from '@pinehill/contracts';
import { httpFailure } from './http-failure.js';

const TIMEOUT_MS = 15000;
const SIGNED_HINT = 'pinehill_guest_signed';

export interface AccountTransport {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function send(path: string, body: unknown, transport: AccountTransport): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, transport.timeoutMs ?? TIMEOUT_MS);
  let response: Response;
  try {
    const run = transport.fetchImpl ?? globalThis.fetch.bind(globalThis);
    response = await run(`/api/session/${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-session-request': '1', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError({
      kind: controller.signal.aborted ? 'timeout' : 'network',
      message: 'Không kết nối được máy chủ.',
    });
  } finally {
    clearTimeout(timer);
  }
  if (response.ok) return;
  const data: unknown = await response.json().catch(() => undefined);
  throw httpFailure(response, data, 'Không thể hoàn tất yêu cầu.');
}

export function registerGuest(
  body: Omit<GuestRegisterRequest, 'clientSurface'>,
  transport: AccountTransport = {},
): Promise<void> {
  return send('register', body, transport);
}

export function requestPasswordReset(
  phone: string,
  transport: AccountTransport = {},
): Promise<void> {
  return send('password-reset/request', { phone }, transport);
}

export function confirmPasswordReset(
  token: string,
  newPassword: string,
  transport: AccountTransport = {},
): Promise<void> {
  return send('password-reset/confirm', { token, newPassword }, transport);
}

/**
 * Có cookie gợi ý "có thể đã đăng nhập" không (TD-42). `false` thì trang khỏi gọi làm mới phiên; `true` chỉ
 * là gợi ý, trạng thái thật vẫn phải hỏi BFF. Gọi được cả khi dựng ở máy chủ (trả `false`).
 */
export function guestSignedHint(cookie?: string): boolean {
  const source = cookie ?? (typeof document === 'undefined' ? '' : document.cookie);
  return source.split(';').some((part) => part.trim() === `${SIGNED_HINT}=1`);
}
