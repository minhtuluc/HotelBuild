/**
 * API giả SCR-08 (HB-023): đăng ký khách và đặt lại mật khẩu qua email. Hợp đồng phát hành ở
 * `packages/contracts/src/auth.ts` (api.md §2.1); máy chủ thật (HB-017/HB-028) chưa có nên đây là mô phỏng
 * theo mã lỗi của api.md §4.2, **không** thay cho nghiệm thu trên API thật.
 *
 * Đăng nhập/làm mới vẫn do `core/auth.ts` xử lý (mọi SĐT hợp lệ đều vào được); ca "sai mật khẩu"/"khoá
 * tài khoản" dùng cổng điều khiển có sẵn `POST /__control/<phone>` với `status` 401/423.
 *
 * Cổng điều khiển riêng (không đụng tiền tố `/__control/` của core):
 *   GET  /__guest/registrations   — các đăng ký đã nhận (không có mật khẩu), để kiểm consent
 *   GET  /__guest/reset-requests  — các SĐT đã yêu cầu đặt lại (mọi yêu cầu đều trả 202)
 *   POST /__guest/reset-token     — phát một token đặt lại dùng một lần, trả `{ token }`
 */
import type { FakeApiContext, FakeHandler, FakeResponse } from '../core/types.js';

/** SĐT đã có hồ sơ khách tại khách sạn: đăng ký với số này → 409 `E_AUTH_PHONE_REGISTERED`. */
export const EXISTING_PROFILE_PHONE = '+84900000001';

const PHONE = /^\+84\d{9}$/;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function apiError(status: number, code: string, path: string): FakeResponse {
  return {
    status,
    body: {
      code,
      message: 'Synthetic guest-auth failure',
      traceId: 'fake-guest-trace',
      timestamp: '2026-10-22T00:00:00.000Z',
      path,
    },
  };
}

export function createHandler(_context: FakeApiContext = {}): FakeHandler {
  const profiles = new Set<string>([EXISTING_PROFILE_PHONE]);
  const registrations: Array<Record<string, unknown>> = [];
  const resetRequests: string[] = [];
  const tokens = new Set<string>();
  let minted = 0;

  return (request) => {
    const path = request.url.pathname;
    if (request.method === 'GET' && path === '/__guest/registrations')
      return { status: 200, body: registrations };
    if (request.method === 'GET' && path === '/__guest/reset-requests')
      return { status: 200, body: resetRequests };
    if (request.method === 'POST' && path === '/__guest/reset-token') {
      const token = `synthetic-reset-${++minted}-${crypto.randomUUID()}`;
      tokens.add(token);
      return { status: 200, body: { token } };
    }
    if (request.method !== 'POST' || !object(request.body)) return undefined;
    const body = request.body;

    if (path === '/api/v1/guest-auth/register') {
      const { phone, fullName, password, consentMarketing, consentVersion, email } = body;
      if (
        typeof phone !== 'string' ||
        !PHONE.test(phone) ||
        typeof fullName !== 'string' ||
        typeof password !== 'string' ||
        password.length < 8 ||
        typeof consentMarketing !== 'boolean' ||
        typeof consentVersion !== 'string'
      )
        return apiError(422, 'E_GEN_VALIDATION_FAILED', path);
      if (profiles.has(phone)) return apiError(409, 'E_AUTH_PHONE_REGISTERED', path);
      profiles.add(phone);
      registrations.push({
        phone,
        fullName,
        email: typeof email === 'string' ? email : null,
        consentMarketing,
        consentVersion,
        clientSurface: body.clientSurface ?? null,
      });
      return {
        status: 201,
        body: {
          tokenType: 'Bearer',
          accessToken: `synthetic-register-access-${registrations.length}-aaaaaaaaaaaa`,
          refreshToken: `synthetic-register-refresh-${registrations.length}-bbbbbbbbbb`,
          expiresInSeconds: 900,
          refreshExpiresInSeconds: 604800,
        },
      };
    }

    if (path === '/api/v1/guest-auth/password-reset/request') {
      if (typeof body.phone !== 'string' || !PHONE.test(body.phone))
        return apiError(422, 'E_CRM_PHONE_INVALID', path);
      resetRequests.push(body.phone);
      // Luôn 202 dù SĐT có tồn tại hay có email hay không (QĐ-03 T7): không lộ gì cho người gọi.
      return { status: 202 };
    }

    if (path === '/api/v1/guest-auth/password-reset/confirm') {
      const { token, newPassword } = body;
      if (typeof token !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8)
        return apiError(422, 'E_GEN_VALIDATION_FAILED', path);
      if (!tokens.delete(token)) return apiError(400, 'E_AUTH_RESET_TOKEN_INVALID', path);
      return { status: 204 };
    }
    return undefined;
  };
}
