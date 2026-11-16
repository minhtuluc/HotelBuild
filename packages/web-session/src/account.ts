import 'server-only';
/**
 * Ba lệnh công khai của khách mà lệnh phiên chưa phủ (HB-324, TD-41; trước đây là BFF riêng của customer
 * web): đăng ký, yêu cầu và xác nhận đặt lại mật khẩu. Đi dưới `/api/session/*`, cùng hàng rào CSRF với
 * lệnh phiên (`Origin` đúng + `x-session-request: 1`). Thân lệnh kiểm bằng schema hợp đồng trước khi gọi API;
 * không ghi log mật khẩu hay token. Lỗi chuyển tiếp `Retry-After` (header và `retryAfterSeconds` trong thân).
 *
 * Đăng ký trả cặp token nhưng cookie refresh chỉ do lệnh đăng nhập đặt: lệnh này **bỏ** phiên vừa tạo (thu
 * hồi best-effort), client đăng nhập ngay sau đó bằng chính SĐT + mật khẩu vừa nhập.
 */
import { ApiClient, ApiError, createAuthApi } from '@pinehill/api-client';
import {
  guestRegisterRequestSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestSchema,
} from '@pinehill/contracts';
import { InvalidInput, jsonRecord, readJsonBody } from './body.js';

export interface GuestAccountOptions {
  baseUrl: string;
  /** Origin chính xác của app; thiếu thì lấy từ URL request (như lệnh phiên). */
  origin?: string;
  fetchImpl?: typeof fetch;
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

function allowed(request: Request, options: GuestAccountOptions): boolean {
  return (
    request.method === 'POST' &&
    request.headers.get('origin') === (options.origin ?? new URL(request.url).origin) &&
    request.headers.get('x-session-request') === '1'
  );
}

export function createGuestAccountHandler(options: GuestAccountOptions) {
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

  /** Phiên vừa tạo không dùng tới: thu hồi; lỗi thu hồi không làm hỏng đăng ký đã thành công. */
  async function discard(accessToken: string): Promise<void> {
    try {
      await client(() => accessToken).requestVoid({ method: 'POST', path: '/guest-auth/logout' });
    } catch {
      // Best-effort: tài khoản đã tạo; token chưa từng rời máy chủ ứng dụng nên hết hạn theo TTL.
    }
  }

  return {
    register: (request: Request): Promise<Response> =>
      guarded(request, async () => {
        const parsed = guestRegisterRequestSchema.safeParse({
          ...jsonRecord(await readJsonBody(request)),
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
        const parsed = passwordResetRequestSchema.safeParse(
          jsonRecord(await readJsonBody(request)),
        );
        if (!parsed.success) throw new InvalidInput();
        await createAuthApi(client()).passwordResetRequest(parsed.data);
        return empty(202);
      }),
    resetConfirm: (request: Request): Promise<Response> =>
      guarded(request, async () => {
        const parsed = passwordResetConfirmRequestSchema.safeParse(
          jsonRecord(await readJsonBody(request)),
        );
        if (!parsed.success) throw new InvalidInput();
        await createAuthApi(client()).passwordResetConfirm(parsed.data);
        return empty(204);
      }),
  };
}
