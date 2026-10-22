import { describe, expect, it } from 'vitest';
import { createAccountHandlers } from '../../src/app/(guest)/account/api/handlers';

const ORIGIN = 'http://127.0.0.1:3001';
const BASE = 'https://api.synthetic.test/api/v1';

interface Upstream {
  method: string;
  path: string;
  authorization: string | null;
  idempotencyKey: string | null;
  body: unknown;
}

const tokenPair = {
  tokenType: 'Bearer',
  accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604800,
};

const failure = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  Response.json(
    {
      code,
      message: 'Synthetic',
      traceId: 'tr',
      timestamp: '2026-10-22T00:00:00Z',
      path: '/x',
      ...extra,
    },
    { status },
  );

function setup(respond: (call: Upstream) => Response | Promise<Response>) {
  const calls: Upstream[] = [];
  const handlers = createAccountHandlers({
    baseUrl: BASE,
    origin: ORIGIN,
    fetchImpl: async (input, init) => {
      const text = typeof init?.body === 'string' ? init.body : undefined;
      const headers = new Headers(init?.headers);
      const call: Upstream = {
        method: init?.method ?? 'GET',
        path: new URL(String(input)).pathname.replace('/api/v1', ''),
        authorization: headers.get('authorization'),
        idempotencyKey: headers.get('idempotency-key'),
        body: text === undefined ? undefined : JSON.parse(text),
      };
      calls.push(call);
      return respond(call);
    },
  });
  return { handlers, calls };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'x-session-request': '1',
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const registerBody = {
  phone: '+84912345678',
  fullName: 'Nguyễn Văn An',
  password: 'S3cret-pass',
  consentMarketing: false,
  consentVersion: '2026-10',
};

describe('register', () => {
  it('registers as GUEST_WEB, revokes the unused upstream session and returns no token', async () => {
    const { handlers, calls } = setup((call) =>
      call.path === '/guest-auth/register'
        ? Response.json(tokenPair, { status: 201 })
        : new Response(null, { status: 204 }),
    );
    const response = await handlers.register(post('/account/api/register', registerBody));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ registered: true });
    expect(text).not.toContain('synthetic-access');
    expect(text).not.toContain('synthetic-refresh');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/guest-auth/register',
      body: { ...registerBody, clientSurface: 'GUEST_WEB' },
    });
    expect(calls[0]?.idempotencyKey).toBeTruthy();
    expect(calls[1]).toMatchObject({
      method: 'POST',
      path: '/auth/logout',
      authorization: `Bearer ${tokenPair.accessToken}`,
    });
  });

  it('still succeeds when revoking the discarded session fails (account is created)', async () => {
    const { handlers } = setup((call) =>
      call.path === '/guest-auth/register'
        ? Response.json(tokenPair, { status: 201 })
        : failure(503, 'E_GEN_SERVICE_UNAVAILABLE'),
    );
    const response = await handlers.register(post('/account/api/register', registerBody));
    expect(response.status).toBe(201);
  });

  it('relays the server error code and status (phone already has a profile)', async () => {
    const { handlers, calls } = setup(() => failure(409, 'E_AUTH_PHONE_REGISTERED'));
    const response = await handlers.register(post('/account/api/register', registerBody));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'E_AUTH_PHONE_REGISTERED' });
    expect(calls).toHaveLength(1);
  });

  it('rejects a body the contract does not accept without calling the API', async () => {
    const { handlers, calls } = setup(() => Response.json(tokenPair));
    for (const body of [
      { ...registerBody, phone: '0912345678' },
      { ...registerBody, password: 'short' },
      { ...registerBody, extra: 1 },
      '{not json',
      '',
    ]) {
      const response = await handlers.register(post('/account/api/register', body));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'E_GEN_VALIDATION_FAILED' });
    }
    expect(calls).toEqual([]);
  });

  it('ignores a client-chosen surface: the BFF always registers as GUEST_WEB', async () => {
    const { handlers, calls } = setup((call) =>
      call.path === '/guest-auth/register'
        ? Response.json(tokenPair, { status: 201 })
        : new Response(null, { status: 204 }),
    );
    const response = await handlers.register(
      post('/account/api/register', { ...registerBody, clientSurface: 'GUEST_ANDROID' }),
    );
    expect(response.status).toBe(201);
    expect(calls[0]?.body).toMatchObject({ clientSurface: 'GUEST_WEB' });
  });

  it('rejects oversized bodies', async () => {
    const { handlers, calls } = setup(() => Response.json(tokenPair));
    const response = await handlers.register(
      post('/account/api/register', { ...registerBody, fullName: 'a'.repeat(20000) }),
    );
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('maps a transport failure to a 502 error body, never a success', async () => {
    const handlers = createAccountHandlers({
      baseUrl: BASE,
      origin: ORIGIN,
      fetchImpl: async () => {
        throw new TypeError('down');
      },
    });
    const response = await handlers.register(post('/account/api/register', registerBody));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'E_GEN_SERVICE_UNAVAILABLE' });
  });

  it('forwards retry-after for rate limiting', async () => {
    const { handlers } = setup(
      () =>
        new Response(
          JSON.stringify({
            code: 'E_GEN_RATE_LIMITED',
            message: 'x',
            traceId: 't',
            timestamp: '2026-10-22T00:00:00Z',
            path: '/x',
            retryAfterSeconds: 42,
          }),
          { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '42' } },
        ),
    );
    const response = await handlers.register(post('/account/api/register', registerBody));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
  });
});

describe('password reset', () => {
  it('request returns 202 with the identical empty answer and sends only the phone', async () => {
    const { handlers, calls } = setup(() => new Response(null, { status: 202 }));
    const response = await handlers.resetRequest(
      post('/account/api/password-reset/request', { phone: '+84912345678' }),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/guest-auth/password-reset/request',
      body: { phone: '+84912345678' },
    });
  });

  it('request rejects a non-canonical phone before any upstream call', async () => {
    const { handlers, calls } = setup(() => new Response(null, { status: 202 }));
    const response = await handlers.resetRequest(
      post('/account/api/password-reset/request', { phone: '0912345678' }),
    );
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('confirm forwards token and new password and answers 204', async () => {
    const { handlers, calls } = setup(() => new Response(null, { status: 204 }));
    const response = await handlers.resetConfirm(
      post('/account/api/password-reset/confirm', { token: 'tok-123', newPassword: 'N3w-secret!' }),
    );
    expect(response.status).toBe(204);
    expect(calls[0]).toMatchObject({
      path: '/guest-auth/password-reset/confirm',
      body: { token: 'tok-123', newPassword: 'N3w-secret!' },
    });
  });

  it('confirm relays an invalid or used token as E_AUTH_RESET_TOKEN_INVALID', async () => {
    const { handlers } = setup(() => failure(400, 'E_AUTH_RESET_TOKEN_INVALID'));
    const response = await handlers.resetConfirm(
      post('/account/api/password-reset/confirm', { token: 'used', newPassword: 'N3w-secret!' }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'E_AUTH_RESET_TOKEN_INVALID' });
  });

  it('never echoes the token or password in an error body', async () => {
    const { handlers } = setup(() => failure(400, 'E_AUTH_RESET_TOKEN_INVALID'));
    const response = await handlers.resetConfirm(
      post('/account/api/password-reset/confirm', {
        token: 'super-secret-token',
        newPassword: 'N3w-secret!',
      }),
    );
    const text = await response.text();
    expect(text).not.toContain('super-secret-token');
    expect(text).not.toContain('N3w-secret!');
  });
});

describe('CSRF', () => {
  it.each([
    ['foreign origin', { origin: 'https://evil.example' }],
    ['missing marker header', { 'x-session-request': '' }],
  ])('%s is refused with 403 and no upstream call', async (_name, headers) => {
    const { handlers, calls } = setup(() => Response.json(tokenPair));
    const response = await handlers.register(post('/account/api/register', registerBody, headers));
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('a request without an origin header is refused', async () => {
    const { handlers, calls } = setup(() => Response.json(tokenPair));
    const request = new Request(`${ORIGIN}/account/api/register`, {
      method: 'POST',
      headers: { 'x-session-request': '1', 'content-type': 'application/json' },
      body: JSON.stringify(registerBody),
    });
    expect((await handlers.register(request)).status).toBe(403);
    expect(calls).toEqual([]);
  });
});
