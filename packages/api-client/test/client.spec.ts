import { describe, expect, it } from 'vitest';
import { tokenPairSchema } from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from '../src/client.js';
import { ApiError, isApiError } from '../src/errors.js';

interface FixtureResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type FetchInput = Parameters<typeof fetch>[0];

function resolveUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

interface Harness {
  calls: { url: string; init: RequestInit }[];
  fetchImpl: typeof fetch;
  delays: number[];
}

/** Fetch giả lập theo kịch bản; lần cuối được lặp lại cho các lần gọi vượt kịch bản. */
function harness(plan: FixtureResponse[]): Harness {
  const calls: { url: string; init: RequestInit }[] = [];
  const delays: number[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: resolveUrl(input), init: init ?? {} });
    if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
    const step = plan[Math.min(calls.length - 1, plan.length - 1)] ?? { status: 200 };
    const headers = new Headers(step.headers ?? {});
    if (step.body !== undefined) headers.set('content-type', 'application/json');
    return new Response(step.body === undefined ? null : JSON.stringify(step.body), {
      status: step.status,
      headers,
    });
  };
  return {
    calls,
    fetchImpl,
    delays,
  };
}

function headerValue(init: RequestInit, name: string): string | undefined {
  const { headers } = init;
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) return headers.find((entry) => entry[0]?.toLowerCase() === name)?.[1];
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  return typeof value === 'string' ? value : undefined;
}

function bodyText(init: RequestInit): string | undefined {
  return typeof init.body === 'string' ? init.body : undefined;
}

function requestInit(calls: { init: RequestInit }[], index: number): RequestInit {
  const call = calls.at(index);
  if (call === undefined) throw new Error(`chưa có yêu cầu thứ ${index}`);
  return call.init;
}

async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error('mong đợi ApiError nhưng lệnh đã thành công');
}

const VALID_TOKENS = {
  tokenType: 'Bearer',
  accessToken: 'access-token-aaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'refresh-token-bbbbbbbb',
  refreshExpiresInSeconds: 604_800,
} as const;

function clientWith(
  h: Harness,
  overrides: Partial<ConstructorParameters<typeof ApiClient>[0]> = {},
) {
  return new ApiClient({
    baseUrl: 'https://api.test/api/v1',
    fetchImpl: h.fetchImpl,
    sleep: async (ms) => {
      h.delays.push(ms);
    },
    createId: () => 'generated-id',
    ...overrides,
  });
}

describe('dựng yêu cầu', () => {
  it('GET không gửi Idempotency-Key và có mã tương quan', async () => {
    const h = harness([{ status: 200, body: { status: 'ok' } }]);
    await clientWith(h).request({
      method: 'GET',
      path: '/system/health',
      decoder: { parse: () => 'ok' },
    });
    expect(headerValue(requestInit(h.calls, 0), 'idempotency-key')).toBeUndefined();
    expect(headerValue(requestInit(h.calls, 0), 'x-correlation-id')).toBe('generated-id');
    expect(h.calls[0]?.url).toBe('https://api.test/api/v1/system/health');
  });

  it('nối query, bỏ qua giá trị undefined', async () => {
    const h = harness([{ status: 200, body: {} }]);
    const client = clientWith(h);
    await client.requestVoid({
      method: 'GET',
      path: '/bookings',
      query: { limit: 20, sort: '-createdAt', cursor: undefined, hasMore: false },
    });
    expect(h.calls[0]?.url).toBe(
      'https://api.test/api/v1/bookings?limit=20&sort=-createdAt&hasMore=false',
    );
  });

  it('chuẩn hoá baseUrl có dấu / thừa', async () => {
    const h = harness([{ status: 200, body: {} }]);
    const client = clientWith(h, { baseUrl: 'https://api.test/api/v1/' });
    await client.requestVoid({ method: 'GET', path: '/system/health' });
    expect(h.calls[0]?.url).toBe('https://api.test/api/v1/system/health');
  });

  it('lệnh ghi tự sinh Idempotency-Key và gửi If-Match khi có', async () => {
    const h = harness([{ status: 204 }]);
    await clientWith(h).requestVoid({
      method: 'PUT',
      path: '/users/u1/access',
      body: {},
      ifMatch: '"7"',
    });
    expect(headerValue(requestInit(h.calls, 0), 'idempotency-key')).toBe('generated-id');
    expect(headerValue(requestInit(h.calls, 0), 'if-match')).toBe('"7"');
  });

  it('gắn Bearer token khi có phiên', async () => {
    const h = harness([{ status: 200, body: { status: 'ok' } }]);
    await clientWith(h, { getAccessToken: () => 'session-token' }).requestVoid({
      method: 'GET',
      path: '/system/health',
    });
    expect(headerValue(requestInit(h.calls, 0), 'authorization')).toBe('Bearer session-token');
  });
});

describe('chèn PIN cho thao tác tài chính', () => {
  it('chặn trước khi gửi khi không có pinToken', async () => {
    const h = harness([{ status: 200, body: {} }]);
    const error = await expectApiError(
      clientWith(h).requestVoid({
        method: 'POST',
        path: '/payments',
        body: { amount: 1_000 },
        pinProtected: true,
      }),
    );
    expect(error.hasCode('E_AUTH_PIN_REQUIRED')).toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it('chèn pinToken vào body khi có', async () => {
    const h = harness([{ status: 201 }]);
    await clientWith(h, { getPinToken: () => 'pin-token-1' }).requestVoid({
      method: 'POST',
      path: '/payments',
      body: { amount: 1_000 },
      pinProtected: true,
    });
    expect(bodyText(requestInit(h.calls, 0))).toBe('{"amount":1000,"pinToken":"pin-token-1"}');
  });
});

describe('chính sách gửi lại', () => {
  it('gửi lại khi 503 và giữ nguyên khoá idempotency + mã tương quan', async () => {
    const h = harness([
      {
        status: 503,
        body: {
          code: 'E_GEN_SERVICE_UNAVAILABLE',
          message: 'bận',
          traceId: 't',
          timestamp: '2026-10-01T00:00:00Z',
          path: '/auth/login',
        },
      },
      { status: 200, body: VALID_TOKENS },
    ]);
    const response = await clientWith(h).request({
      method: 'POST',
      path: '/auth/login',
      body: { username: 'owner', password: 'x'.repeat(10) },
      decoder: tokenPairSchema,
    });
    expect(response.data.accessToken).toBe(VALID_TOKENS.accessToken);
    expect(h.calls).toHaveLength(2);
    expect(headerValue(requestInit(h.calls, 1), 'idempotency-key')).toBe('generated-id');
    expect(headerValue(requestInit(h.calls, 1), 'x-correlation-id')).toBe('generated-id');
  });

  it('không gửi lại khi lỗi nghiệp vụ 422', async () => {
    const h = harness([
      {
        status: 422,
        body: {
          code: 'E_BOOK_OVER_CAPACITY',
          message: 'Quá sức chứa',
          traceId: 'trace-422',
          timestamp: '2026-10-01T00:00:00Z',
          path: '/bookings',
          details: [{ field: 'adults', issue: 'OUT_OF_RANGE' }],
        },
      },
    ]);
    const error = await expectApiError(
      clientWith(h).requestVoid({ method: 'POST', path: '/bookings', body: {} }),
    );
    expect(h.calls).toHaveLength(1);
    expect(error.status).toBe(422);
    expect(error.knownCode).toBe('E_BOOK_OVER_CAPACITY');
    expect(error.details?.[0]?.field).toBe('adults');
    expect(error.traceId).toBe('trace-422');
    expect(error.retryable).toBe(false);
  });

  it('tôn trọng Retry-After khi khoá idempotency đang bận', async () => {
    const h = harness([
      {
        status: 409,
        headers: { 'retry-after': '3' },
        body: {
          code: 'E_SYS_REQUEST_IN_PROGRESS',
          message: 'Đang xử lý',
          traceId: 'trace-busy',
          timestamp: '2026-10-01T00:00:00Z',
          path: '/holds',
        },
      },
      { status: 201, body: VALID_TOKENS },
    ]);
    await clientWith(h).request({
      method: 'POST',
      path: '/holds',
      body: {},
      decoder: tokenPairSchema,
    });
    expect(h.delays).toEqual([3_000]);
  });

  it('dừng sau số lần gửi tối đa và trả lỗi cuối', async () => {
    const h = harness([
      {
        status: 502,
        body: {
          code: 'E_PAY_GATEWAY_ERROR',
          message: 'cổng lỗi',
          traceId: 't',
          timestamp: '2026-10-01T00:00:00Z',
          path: '/payments',
        },
      },
    ]);
    const error = await expectApiError(
      clientWith(h).requestVoid({
        method: 'POST',
        path: '/payments',
        body: {},
        idempotencyKey: 'k-1',
      }),
    );
    expect(h.calls).toHaveLength(3);
    expect(error.status).toBe(502);
    expect(error.retryable).toBe(true);
  });

  it('mã lỗi ngoài danh mục vẫn đọc được nhưng không thu hẹp được', async () => {
    const h = harness([
      {
        status: 409,
        body: {
          code: 'E_FUTURE_NEW_CODE',
          message: 'mới',
          traceId: 't',
          timestamp: '2026-10-01T00:00:00Z',
          path: '/x',
        },
      },
    ]);
    const error = await expectApiError(
      clientWith(h).requestVoid({ method: 'POST', path: '/x', body: {} }),
    );
    expect(error.code).toBe('E_FUTURE_NEW_CODE');
    expect(error.knownCode).toBeUndefined();
  });
});

describe('hết thời gian và huỷ', () => {
  const neverResponds: typeof fetch = (_input, init) => {
    const { promise, reject } = Promise.withResolvers<Response>();
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    );
    return promise;
  };

  it('hết thời gian chờ là lỗi có thể gửi lại', async () => {
    const client = new ApiClient({
      baseUrl: 'https://api.test/api/v1',
      fetchImpl: neverResponds,
      timeoutMs: 5,
      maxAttempts: 1,
      sleep: async () => undefined,
    });
    const error = await expectApiError(
      client.requestVoid({ method: 'GET', path: '/system/health' }),
    );
    expect(error.kind).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  it('người gọi huỷ thì không gửi lại', async () => {
    const h = harness([{ status: 200, body: {} }]);
    const controller = new AbortController();
    controller.abort();
    const error = await expectApiError(
      clientWith(h).requestVoid({
        method: 'GET',
        path: '/system/health',
        signal: controller.signal,
      }),
    );
    expect(error.kind).toBe('aborted');
    expect(error.retryable).toBe(false);
    expect(h.calls).toHaveLength(1);
  });
});

describe('đọc phản hồi', () => {
  it('phản hồi sai hợp đồng là lỗi protocol', async () => {
    const h = harness([{ status: 200, body: { tokenType: 'Bearer' } }]);
    const error = await expectApiError(
      clientWith(h).request({
        method: 'POST',
        path: '/auth/login',
        body: {},
        decoder: tokenPairSchema,
      }),
    );
    expect(error.kind).toBe('protocol');
  });

  it('đọc cờ phát lại, ETag và X-Trace-Id', async () => {
    const h = harness([
      {
        status: 200,
        body: VALID_TOKENS,
        headers: { 'idempotency-replayed': 'true', etag: '"7"', 'x-trace-id': 'trace-9' },
      },
    ]);
    const response = await clientWith(h).request({
      method: 'POST',
      path: '/auth/login',
      body: {},
      decoder: tokenPairSchema,
    });
    expect(response.replayed).toBe(true);
    expect(response.etag).toBe('"7"');
    expect(response.traceId).toBe('trace-9');
  });

  it('204 trả data undefined', async () => {
    const h = harness([{ status: 204 }]);
    const response: ApiResponse<undefined> = await clientWith(h).requestVoid({
      method: 'DELETE',
      path: '/holds/h1',
    });
    expect(response.data).toBeUndefined();
    expect(response.status).toBe(204);
  });
});
