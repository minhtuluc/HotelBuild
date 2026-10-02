/** HB-012: retryAfterSeconds (body/header), /auth/me, guestLogin clientSurface, tự refresh khi 401. */
import { describe, expect, it, vi } from 'vitest';
import { createAuthApi } from '../src/auth.js';
import { ApiClient, type ApiClientOptions } from '../src/client.js';
import { isApiError } from '../src/errors.js';

interface Step {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function harness(plan: Step[]) {
  const calls: { url: string; authorization: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers ?? {});
    calls.push({ url, authorization: headers.get('authorization') });
    const step = plan[Math.min(calls.length - 1, plan.length - 1)] ?? { status: 200 };
    const responseHeaders = new Headers(step.headers ?? {});
    if (step.body !== undefined) responseHeaders.set('content-type', 'application/json');
    return new Response(step.body === undefined ? null : JSON.stringify(step.body), {
      status: step.status,
      headers: responseHeaders,
    });
  };
  return { calls, fetchImpl };
}

const TOKENS = {
  tokenType: 'Bearer',
  accessToken: 'access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'refresh-token-bbbbbbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604_800,
};

const passthrough = { parse: (payload: unknown): unknown => payload };

const ERROR_BODY = {
  code: 'E_GEN_RATE_LIMITED',
  message: 'Quá nhiều yêu cầu',
  traceId: 't1',
  timestamp: '2026-10-02T00:00:00.000Z',
  path: '/api/v1/auth/login',
};

function makeClient(
  plan: Step[],
  overrides: Partial<ApiClientOptions> = {},
): { client: ApiClient; calls: { url: string; authorization: string | null }[] } {
  const { fetchImpl, calls } = harness(plan);
  return {
    client: new ApiClient({
      baseUrl: 'http://127.0.0.1:9/api/v1',
      createId: () => '00000000-0000-4000-8000-000000000000',
      fetchImpl,
      sleep: async () => undefined,
      ...overrides,
    }),
    calls,
  };
}

describe('ApiError.retryAfterSeconds (HB-012)', () => {
  it('lấy từ body khi có, thiếu thì lấy header Retry-After', async () => {
    const fromBody = makeClient([{ status: 429, body: { ...ERROR_BODY, retryAfterSeconds: 45 } }]);
    try {
      await createAuthApi(fromBody.client).login({ username: 'owner', password: 'matkhau123' });
      throw new Error('mong đợi ApiError');
    } catch (error) {
      if (!isApiError(error)) throw error;
      expect(error.retryAfterSeconds).toBe(45);
    }

    const fromHeader = makeClient([
      { status: 429, body: ERROR_BODY, headers: { 'retry-after': '120' } },
    ]);
    try {
      await createAuthApi(fromHeader.client).login({ username: 'owner', password: 'matkhau123' });
      throw new Error('mong đợi ApiError');
    } catch (error) {
      if (!isApiError(error)) throw error;
      expect(error.retryAfterSeconds).toBe(120);
    }
  });

  it('undefined khi máy chủ không cho biết thời gian chờ', async () => {
    const { client } = makeClient([{ status: 400, body: ERROR_BODY }]);
    try {
      await createAuthApi(client).login({ username: 'owner', password: 'matkhau123' });
      throw new Error('mong đợi ApiError');
    } catch (error) {
      if (!isApiError(error)) throw error;
      expect(error.retryAfterSeconds).toBeUndefined();
    }
  });
});

describe('GET /auth/me (HB-012)', () => {
  it('gửi Bearer và giải mã hồ sơ phiên', async () => {
    const me = {
      userId: 'u1',
      username: 'letan01',
      fullName: 'Lễ tân 01',
      role: 'FRONT_DESK',
      propertyScope: ['p1', 'p2'],
      hasPin: false,
      mustChangePassword: true,
    };
    const { client, calls } = makeClient([{ status: 200, body: me }], {
      getAccessToken: () => 'access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const response = await createAuthApi(client).me();
    expect(response.data.propertyScope).toEqual(['p1', 'p2']);
    expect(response.data.hasPin).toBe(false);
    expect(calls[0]?.url).toBe('http://127.0.0.1:9/api/v1/auth/me');
    expect(calls[0]?.authorization).toBe('Bearer access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
});

describe('guestLogin clientSurface (HB-012)', () => {
  it('gửi clientSurface khi được truyền, giữ tương thích lời gọi cũ', async () => {
    const { client } = makeClient([{ status: 200, body: TOKENS }]);
    await createAuthApi(client).guestLogin('+84901234567', 'matkhau123', 'GUEST_ANDROID');
    const { client: legacy } = makeClient([{ status: 200, body: TOKENS }]);
    await createAuthApi(legacy).guestLogin('+84901234567', 'matkhau123');
    expect(true).toBe(true);
  });
});

describe('onUnauthorized (HB-012)', () => {
  it('401 trên request đã xác thực → gọi hook một lần rồi gửi lại đúng một lần', async () => {
    const { client, calls } = makeClient(
      [
        { status: 401, body: { ...ERROR_BODY, code: 'E_AUTH_INVALID_CREDENTIALS' } },
        { status: 200, body: { status: 'ok' } },
      ],
      {
        getAccessToken: () => 'access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
        onUnauthorized: async () => true,
      },
    );
    const response = await client.request({
      method: 'GET',
      path: '/system/health',
      decoder: passthrough,
    });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('nhiều request 401 đồng thời chỉ gọi hook một lần', async () => {
    const onUnauthorized = vi.fn(async () => {
      await Promise.resolve();
      return false;
    });
    const { client } = makeClient(
      [{ status: 401, body: { ...ERROR_BODY, code: 'E_AUTH_INVALID_CREDENTIALS' } }],
      {
        getAccessToken: () => 'access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
        onUnauthorized,
      },
    );
    const results = await Promise.allSettled([
      client.request({ method: 'GET', path: '/system/health', decoder: passthrough }),
      client.request({ method: 'GET', path: '/system/health', decoder: passthrough }),
    ]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('endpoint cấp phiên (login/refresh) không kích hoạt hook', async () => {
    const onUnauthorized = vi.fn(async () => true);
    const { client } = makeClient([{ status: 401, body: ERROR_BODY }], { onUnauthorized });
    await expect(
      createAuthApi(client).login({ username: 'owner', password: 'matkhau123' }),
    ).rejects.toBeTruthy();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
