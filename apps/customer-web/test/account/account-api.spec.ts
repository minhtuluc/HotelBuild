import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import {
  confirmPasswordReset,
  registerGuest,
  requestPasswordReset,
} from '../../src/app/(guest)/account/account-api';

interface Seen {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: unknown;
}

function capture(respond: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return respond();
  };
  return { seen, transport: { fetchImpl } };
}

const failure = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  Response.json(
    { code, message: 'x', traceId: 't', timestamp: '2026-10-22T00:00:00Z', path: '/x', ...extra },
    { status },
  );

const body = {
  phone: '+84912345678',
  fullName: 'An',
  password: 'S3cret-pass',
  consentMarketing: false,
  consentVersion: '2026-10',
};

describe('account-api', () => {
  it('posts to same-origin BFF routes with the CSRF marker', async () => {
    const reg = capture(() => Response.json({ registered: true }, { status: 201 }));
    await registerGuest(body, reg.transport);
    expect(reg.seen[0]).toMatchObject({ url: '/account/api/register', method: 'POST', body });
    expect(reg.seen[0]?.headers.get('x-session-request')).toBe('1');

    const req = capture(() => new Response(null, { status: 202 }));
    await requestPasswordReset('+84912345678', req.transport);
    expect(req.seen[0]).toMatchObject({
      url: '/account/api/password-reset/request',
      body: { phone: '+84912345678' },
    });

    const conf = capture(() => new Response(null, { status: 204 }));
    await confirmPasswordReset('tok', 'N3w-secret!', conf.transport);
    expect(conf.seen[0]).toMatchObject({
      url: '/account/api/password-reset/confirm',
      body: { token: 'tok', newPassword: 'N3w-secret!' },
    });
  });

  it('turns an error body into an ApiError carrying only code/status/retry-after', async () => {
    const { transport } = capture(() => failure(409, 'E_AUTH_PHONE_REGISTERED'));
    const error = await registerGuest(body, transport).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', status: 409, code: 'E_AUTH_PHONE_REGISTERED' });

    const limited = capture(() => failure(429, 'E_GEN_RATE_LIMITED', { retryAfterSeconds: 42 }));
    expect(
      await requestPasswordReset('+84912345678', limited.transport).catch((c: unknown) => c),
    ).toMatchObject({ status: 429, retryAfterSeconds: 42 });
  });

  it('keeps the status when the error body is not a contract body', async () => {
    const { transport } = capture(() => new Response('<html>', { status: 502 }));
    const error = await registerGuest(body, transport).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'http', status: 502 });
    expect(error).toHaveProperty('code', undefined);
  });

  it('reports a thrown fetch as a network error (outcome unknown)', async () => {
    const transport = {
      fetchImpl: (async () => {
        throw new TypeError('offline');
      }) satisfies typeof fetch,
    };
    expect(await registerGuest(body, transport).catch((c: unknown) => c)).toMatchObject({
      kind: 'network',
    });
  });

  it('reports an aborted slow request as a timeout', async () => {
    const transport = {
      timeoutMs: 5,
      fetchImpl: ((_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        })) satisfies typeof fetch,
    };
    expect(await registerGuest(body, transport).catch((c: unknown) => c)).toMatchObject({
      kind: 'timeout',
    });
  });
});
