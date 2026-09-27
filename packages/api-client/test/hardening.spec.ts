import { getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenPairSchema, operationRefSchema } from '@pinehill/contracts';
import * as publicSurface from '../src/index.js';
import { ApiClient } from '../src/client.js';
import { ApiError, isApiError } from '../src/errors.js';

interface Fixture {
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

function responseFor(step: Fixture): Response {
  const headers = new Headers(step.headers ?? {});
  if (step.body !== undefined) headers.set('content-type', 'application/json');
  return new Response(step.body === undefined ? null : JSON.stringify(step.body), {
    status: step.status,
    headers,
  });
}

function harness(plan: Fixture[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: resolveUrl(input), init: init ?? {} });
    if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
    return responseFor(plan[Math.min(calls.length - 1, plan.length - 1)] ?? { status: 200 });
  };
  return { calls, fetchImpl };
}

function idempotencyKeyOf(init: RequestInit): string | undefined {
  const { headers } = init;
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get('idempotency-key') ?? undefined;
  if (Array.isArray(headers))
    return headers.find((entry) => entry[0]?.toLowerCase() === 'idempotency-key')?.[1];
  const value = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === 'idempotency-key',
  )?.[1];
  return typeof value === 'string' ? value : undefined;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sinh Idempotency-Key / mã tương quan (F0-06)', () => {
  it('sinh UUIDv4 hợp lệ từ nguồn ngẫu nhiên của nền tảng', async () => {
    const h = harness([{ status: 201, body: { status: 'ok' } }]);
    const client = new ApiClient({ baseUrl: 'https://api.test/api/v1', fetchImpl: h.fetchImpl });
    await client.requestVoid({ method: 'POST', path: '/bookings', body: {} });
    const key = idempotencyKeyOf(h.calls[0]?.init ?? {});
    expect(key).toMatch(UUID_V4);
  });

  it('dùng nguồn getRandomValues khi không có randomUUID, đặt đúng bit version/variant', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array): Uint8Array => {
        for (let index = 0; index < array.length; index += 1) array[index] = index;
        return array;
      },
    });
    const h = harness([{ status: 201, body: { status: 'ok' } }]);
    const client = new ApiClient({ baseUrl: 'https://api.test/api/v1', fetchImpl: h.fetchImpl });
    await client.requestVoid({ method: 'POST', path: '/bookings', body: {} });
    expect(idempotencyKeyOf(h.calls[0]?.init ?? {})).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('không có nguồn an toàn thì dừng ngay, không sinh ID yếu', () => {
    vi.stubGlobal('crypto', undefined);
    expect(
      () => new ApiClient({ baseUrl: 'https://api.test/api/v1', fetchImpl: harness([]).fetchImpl }),
    ).toThrow(/nguồn ngẫu nhiên an toàn/);
  });

  it('createId do nền tảng cung cấp được ưu tiên và dùng nguyên văn', async () => {
    vi.stubGlobal('crypto', undefined);
    const h = harness([{ status: 201, body: { status: 'ok' } }]);
    const client = new ApiClient({
      baseUrl: 'https://api.test/api/v1',
      fetchImpl: h.fetchImpl,
      createId: () => 'id-tu-expo-crypto',
    });
    await client.requestVoid({ method: 'POST', path: '/bookings', body: {} });
    expect(idempotencyKeyOf(h.calls[0]?.init ?? {})).toBe('id-tu-expo-crypto');
  });
});

describe('hạn thời gian bao trọn phần đọc thân phản hồi (F0-07)', () => {
  /** Mô phỏng trung thực fetch thật: huỷ tín hiệu làm hỏng luồng thân phản hồi. */
  const hangingBody: typeof fetch = async (_input, init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () => {
          controller.error(new DOMException('aborted', 'AbortError'));
        });
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
  };

  it('headers đã về nhưng body treo vẫn bị cắt bởi timeout', async () => {
    const client = new ApiClient({
      baseUrl: 'https://api.test/api/v1',
      fetchImpl: hangingBody,
      timeoutMs: 25,
      maxAttempts: 1,
    });
    const error = await client
      .request({ method: 'GET', path: '/bookings', decoder: tokenPairSchema })
      .catch((thrown: unknown) => thrown);
    expect(isApiError(error)).toBe(true);
    if (!isApiError(error)) throw new Error('mong đợi ApiError');
    expect(error.kind).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  it('dọn listener trên tín hiệu người gọi sau khi thành công', async () => {
    const h = harness([{ status: 200, body: { status: 'ok' } }]);
    const controller = new AbortController();
    const client = new ApiClient({ baseUrl: 'https://api.test/api/v1', fetchImpl: h.fetchImpl });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    await client.requestVoid({ method: 'GET', path: '/system/health', signal: controller.signal });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('dọn listener cả khi lệnh thất bại', async () => {
    const h = harness([
      {
        status: 422,
        body: {
          code: 'E_BOOK_OVER_CAPACITY',
          message: 'x',
          traceId: 't',
          timestamp: '2026-10-01T00:00:00Z',
          path: '/bookings',
        },
      },
    ]);
    const controller = new AbortController();
    const client = new ApiClient({ baseUrl: 'https://api.test/api/v1', fetchImpl: h.fetchImpl });
    await client
      .requestVoid({ method: 'POST', path: '/bookings', body: {}, signal: controller.signal })
      .catch(() => undefined);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
});

describe('nhánh lỗi kết nối và thân phản hồi không phải JSON', () => {
  it('lỗi mạng (không do huỷ) là lỗi có thể gửi lại', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('failed to fetch');
    };
    const client = new ApiClient({
      baseUrl: 'https://api.test/api/v1',
      fetchImpl: failing,
      maxAttempts: 1,
      sleep: async () => undefined,
    });
    const error = await client
      .requestVoid({ method: 'GET', path: '/system/health' })
      .catch((thrown: unknown) => thrown);
    if (!isApiError(error)) throw new Error('mong đợi ApiError');
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('thân phản hồi không phải JSON bị coi là lỗi giao thức, không phải thành công', async () => {
    const html: typeof fetch = async () => new Response('<html>proxy</html>', { status: 200 });
    const client = new ApiClient({
      baseUrl: 'https://api.test/api/v1',
      fetchImpl: html,
      maxAttempts: 1,
    });
    const error = await client
      .request({ method: 'GET', path: '/bookings', decoder: tokenPairSchema })
      .catch((thrown: unknown) => thrown);
    if (!isApiError(error)) throw new Error('mong đợi ApiError');
    expect(error.kind).toBe('protocol');
  });

  it('phản hồi 204 trả về undefined và không gọi decoder', async () => {
    const h = harness([{ status: 204 }]);
    const client = new ApiClient({ baseUrl: 'https://api.test/api/v1', fetchImpl: h.fetchImpl });
    const response = await client.requestVoid({ method: 'POST', path: '/auth/logout' });
    expect(response.data).toBeUndefined();
  });
});

describe('bề mặt công khai của gói', () => {
  it('xuất đủ client, bộ giải mã tác vụ và kiểu lỗi', () => {
    expect(typeof publicSurface.ApiClient).toBe('function');
    expect(typeof publicSurface.createAuthApi).toBe('function');
    expect(typeof publicSurface.isApiError).toBe('function');
    expect(publicSurface.ApiError).toBe(ApiError);
    expect(
      publicSurface.operationRefDecoder.parse({
        operationId: 'op-1',
        status: 'PENDING',
        statusUrl: '/x',
      }),
    ).toEqual({
      operationId: 'op-1',
      status: 'PENDING',
      statusUrl: '/x',
    });
    expect(
      operationRefSchema.safeParse({ operationId: 'op-1', status: 'PENDING', statusUrl: '/x' })
        .success,
    ).toBe(true);
  });
});
