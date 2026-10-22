/**
 * BFF cho ba lệnh **công khai** của SCR-08 mà proxy phiên (`/api/session/*`) và proxy hành trình chưa phủ:
 * đăng ký, yêu cầu và xác nhận đặt lại mật khẩu. Trình duyệt chỉ nói chuyện cùng origin (CSRF như
 * `createSessionHandler`: `Origin` đúng + `x-session-request: 1`); thân lệnh được kiểm bằng schema hợp đồng
 * trước khi gọi API, không ghi/log mật khẩu hay token.
 *
 * Đăng ký trả cặp token nhưng cookie refresh chỉ do `/api/session/login` được đặt; vì vậy lệnh này **bỏ**
 * phiên vừa tạo (thu hồi best-effort) và client đăng nhập ngay sau đó bằng chính SĐT + mật khẩu vừa nhập.
 */
import { ApiClient, ApiError, createAuthApi } from '@pinehill/api-client';
import {
  guestRegisterRequestSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestSchema,
} from '@pinehill/contracts';

export interface AccountHandlerOptions {
  baseUrl: string;
  /** Origin chính xác của app; thiếu thì lấy từ URL request (như proxy phiên). */
  origin?: string;
  fetchImpl?: typeof fetch;
}

const BODY_LIMIT = 16384;

class InvalidInput extends Error {}

async function readJson(request: Request): Promise<unknown> {
  if (!request.body) throw new InvalidInput();
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) throw new InvalidInput();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value;
  } catch {
    throw new InvalidInput();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidInput();
  return { ...value };
}

function statusOf(error: unknown): number {
  if (error instanceof InvalidInput) return 400;
  const status = error instanceof ApiError ? error.status : undefined;
  return status !== undefined && status >= 400 ? status : 502;
}

function codeOf(error: unknown): string {
  if (error instanceof InvalidInput) return 'E_GEN_VALIDATION_FAILED';
  return (error instanceof ApiError ? error.knownCode : undefined) ?? 'E_GEN_SERVICE_UNAVAILABLE';
}

function failure(request: Request, error: unknown): Response {
  const wait = error instanceof ApiError ? error.retryAfterSeconds : undefined;
  return Response.json(
    {
      code: codeOf(error),
      message: 'Không thể hoàn tất yêu cầu.',
      traceId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      path: new URL(request.url).pathname,
      ...(wait === undefined ? {} : { retryAfterSeconds: wait }),
    },
    {
      status: statusOf(error),
      headers: {
        'cache-control': 'no-store',
        ...(wait === undefined ? {} : { 'retry-after': String(wait) }),
      },
    },
  );
}

function allowed(request: Request, options: AccountHandlerOptions): boolean {
  return (
    request.method === 'POST' &&
    request.headers.get('origin') === (options.origin ?? new URL(request.url).origin) &&
    request.headers.get('x-session-request') === '1'
  );
}

export function createAccountHandlers(options: AccountHandlerOptions) {
  const client = (getAccessToken?: () => string): ApiClient =>
    new ApiClient({
      baseUrl: options.baseUrl,
      maxAttempts: 1,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(getAccessToken === undefined ? {} : { getAccessToken }),
    });

  async function guarded(request: Request, work: () => Promise<Response>): Promise<Response> {
    if (!allowed(request, options))
      return failure(
        request,
        new ApiError({ kind: 'http', status: 403, code: 'E_RBAC_FORBIDDEN', message: 'CSRF' }),
      );
    try {
      return await work();
    } catch (error) {
      return failure(request, error);
    }
  }

  const empty = (status: number): Response =>
    new Response(null, { status, headers: { 'cache-control': 'no-store' } });

  /** Phiên vừa tạo không dùng tới: thu hồi, và lỗi thu hồi không làm hỏng đăng ký đã thành công. */
  async function discard(accessToken: string): Promise<void> {
    try {
      await client(() => accessToken).requestVoid({ method: 'POST', path: '/auth/logout' });
    } catch {
      // Best-effort: tài khoản đã tạo; token chưa từng rời máy chủ ứng dụng nên hết hạn theo TTL.
    }
  }

  return {
    register: (request: Request): Promise<Response> =>
      guarded(request, async () => {
        const parsed = guestRegisterRequestSchema.safeParse({
          ...record(await readJson(request)),
          clientSurface: 'GUEST_WEB',
        });
        if (!parsed.success) throw new InvalidInput();
        const pair = await createAuthApi(client()).guestRegister(parsed.data);
        await discard(pair.data.accessToken);
        return Response.json(
          { registered: true },
          { status: 201, headers: { 'cache-control': 'no-store' } },
        );
      }),
    resetRequest: (request: Request): Promise<Response> =>
      guarded(request, async () => {
        const parsed = passwordResetRequestSchema.safeParse(record(await readJson(request)));
        if (!parsed.success) throw new InvalidInput();
        await createAuthApi(client()).passwordResetRequest(parsed.data);
        return empty(202);
      }),
    resetConfirm: (request: Request): Promise<Response> =>
      guarded(request, async () => {
        const parsed = passwordResetConfirmRequestSchema.safeParse(record(await readJson(request)));
        if (!parsed.success) throw new InvalidInput();
        await createAuthApi(client()).passwordResetConfirm(parsed.data);
        return empty(204);
      }),
  };
}
