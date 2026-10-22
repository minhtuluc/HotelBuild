/**
 * Lớp gọi của SCR-08 từ trình duyệt: ba lệnh công khai qua BFF cùng origin (`./api/handlers.ts`).
 * Lỗi được chuẩn hoá thành `ApiError` (mã `code` từ thân lỗi hợp đồng) để `failureOf` phân loại; mất mạng
 * hoặc hết giờ là `network`/`timeout` — **chưa xác định kết quả**, không phải thất bại chắc chắn.
 * Không ghi/log thân lệnh (mật khẩu, token).
 */
import { ApiError } from '@pinehill/api-client';
import { errorBodySchema } from '@pinehill/contracts';
import type { GuestRegisterRequest } from '@pinehill/contracts';

const TIMEOUT_MS = 15000;

export interface AccountTransport {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function send(path: string, body: unknown, transport: AccountTransport): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, transport.timeoutMs ?? TIMEOUT_MS);
  try {
    const run = transport.fetchImpl ?? globalThis.fetch.bind(globalThis);
    return await run(path, {
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
}

async function failureOf(response: Response): Promise<ApiError> {
  const parsed = errorBodySchema.safeParse(await response.json().catch(() => undefined));
  return new ApiError({
    kind: 'http',
    status: response.status,
    code: parsed.success ? parsed.data.code : undefined,
    retryAfterSeconds: parsed.success ? parsed.data.retryAfterSeconds : undefined,
    message: 'Không thể hoàn tất yêu cầu.',
  });
}

async function post(path: string, body: unknown, transport: AccountTransport): Promise<void> {
  const response = await send(path, body, transport);
  if (!response.ok) throw await failureOf(response);
}

export function registerGuest(
  body: Omit<GuestRegisterRequest, 'clientSurface'>,
  transport: AccountTransport = {},
): Promise<void> {
  return post('/account/api/register', body, transport);
}

export function requestPasswordReset(
  phone: string,
  transport: AccountTransport = {},
): Promise<void> {
  return post('/account/api/password-reset/request', { phone }, transport);
}

export function confirmPasswordReset(
  token: string,
  newPassword: string,
  transport: AccountTransport = {},
): Promise<void> {
  return post('/account/api/password-reset/confirm', { token, newPassword }, transport);
}
