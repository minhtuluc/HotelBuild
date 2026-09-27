import { describe, expect, it } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { probeHealth } from '../src/probe';

function clientWith(fetchImpl: typeof fetch): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test/api/v1',
    fetchImpl,
    createId: () => '11111111-1111-4111-8111-111111111111',
    maxAttempts: 1,
    sleep: async () => undefined,
  });
}

const envelope = (code: string, traceId: string) => ({
  code,
  message: 'lỗi',
  traceId,
  timestamp: '2026-10-01T00:00:00.000Z',
  path: '/api/v1/system/health',
});

describe('smoke gọi API của shell Android (F0-08)', () => {
  it('thành công khi máy chủ trả 200', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    expect(await probeHealth(clientWith(fetchImpl))).toEqual({ kind: 'ok' });
  });

  it('thiếu quyền khi máy chủ trả 403', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(envelope('E_RBAC_FORBIDDEN', 't403')), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    expect(await probeHealth(clientWith(fetchImpl))).toEqual({ kind: 'forbidden' });
  });

  it('thất bại kèm mã lỗi và mã tham chiếu khi máy chủ trả 500', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(envelope('E_GEN_SERVICE_UNAVAILABLE', 't500')), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    expect(await probeHealth(clientWith(fetchImpl))).toEqual({
      kind: 'failed',
      code: 'E_GEN_SERVICE_UNAVAILABLE',
      reference: 't500',
    });
  });

  it('lỗi mạng được báo là thất bại có thể gửi lại, không phải thành công', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('network down');
    };
    const outcome = await probeHealth(clientWith(fetchImpl));
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('mong đợi thất bại');
    expect(outcome.code).toBe('network');
  });
});
