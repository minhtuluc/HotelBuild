import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createSessionHandler } from '../src/server.js';

const pair = {
  tokenType: 'Bearer',
  accessToken: 'synthetic-access-token-0001',
  refreshToken: 'synthetic-refresh-token-0001',
  expiresInSeconds: 900,
  refreshExpiresInSeconds: 604800,
  mustChangePassword: true,
  extraSecret: 'must-not-escape',
};
const calls: { path: string; body: unknown; authorization: string | undefined }[] = [];
let status = 200;
let responseBody: unknown = pair;
let server: Server,
  baseUrl = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const raw of req) {
        const chunk: unknown = raw;
        if (!(chunk instanceof Uint8Array)) throw new Error('Invalid HTTP chunk');
        chunks.push(Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString();
      const body: unknown = text ? JSON.parse(text) : undefined;
      calls.push({ path: req.url ?? '', body, authorization: req.headers.authorization });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        status === 200
          ? JSON.stringify(responseBody)
          : status === 204
            ? undefined
            : JSON.stringify({
                code: status === 429 ? 'E_GEN_RATE_LIMITED' : 'E_AUTH_INVALID_CREDENTIALS',
                message: pair.refreshToken,
                traceId: 'safe-trace',
                timestamp: '2026-10-07T00:00:00.000Z',
                path: req.url,
                retryAfterSeconds: 42,
              }),
      );
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP port');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});
beforeEach(() => {
  calls.length = 0;
  status = 200;
  responseBody = pair;
});
function request(
  action: string,
  body?: unknown,
  headers: Record<string, string> = {},
  origin = 'https://ops.test',
) {
  return new Request(`${origin}/api/session/${action}`, {
    method: 'POST',
    headers: { origin, 'x-session-request': '1', 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test.each(['staff', 'guest'] as const)(
  'login %s pins surface and returns only public fields',
  async (kind) => {
    const handle = createSessionHandler({ kind, baseUrl });
    const body =
      kind === 'staff'
        ? { username: 'synthetic', password: 'synthetic-password', clientSurface: 'OPS_ANDROID' }
        : { phone: '+84912345678', password: 'synthetic-password', clientSurface: 'GUEST_ANDROID' };
    const r = await handle(request('login', body), 'login');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      accessToken: pair.accessToken,
      expiresInSeconds: 900,
      mustChangePassword: true,
    });
    expect(calls[0]).toMatchObject({
      path: kind === 'staff' ? '/api/v1/auth/login' : '/api/v1/guest-auth/login',
      body: { clientSurface: kind === 'staff' ? 'OPS_WEB' : 'GUEST_WEB' },
    });
    const cookie = r.headers.get('set-cookie') ?? '';
    for (const flag of [
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      'Path=/api/session',
      'Max-Age=604800',
    ])
      expect(cookie).toContain(flag);
    expect(r.headers.get('cache-control')).toBe('no-store');
  },
);
test.each([
  ['http://127.0.0.1', true, false],
  ['http://127.0.0.1', false, true],
  ['http://localhost', true, true],
  ['https://ops.test', true, true],
] as const)('cookie Secure matrix %s development=%s', async (origin, development, secure) => {
  const r = await createSessionHandler({ kind: 'staff', baseUrl, development })(
    request('login', { username: 'synthetic', password: 'synthetic-password' }, {}, origin),
    'login',
  );
  expect(r.status).toBe(200);
  expect(r.headers.get('set-cookie')?.includes('; Secure')).toBe(secure);
});
test.each([
  { origin: 'https://evil.test' },
  { 'x-session-request': '0' },
  { origin: '' },
  { 'x-session-request': '' },
])('CSRF rejected before upstream %#', async (headers) => {
  const r = await createSessionHandler({ kind: 'staff', baseUrl })(
    request('login', {}, headers),
    'login',
  );
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({ code: 'E_RBAC_FORBIDDEN', path: '/api/session/login' });
  expect(calls).toHaveLength(0);
});
test('refresh reads cookie only and rotates; browser body is never a refresh source', async () => {
  const handle = createSessionHandler({ kind: 'guest', baseUrl });
  const login = await handle(
    request('login', { phone: '+84912345678', password: 'synthetic-password' }),
    'login',
  );
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  calls.length = 0;
  const r = await handle(
    request('refresh', { refreshToken: 'attacker-override' }, { cookie }),
    'refresh',
  );
  expect(r.status).toBe(200);
  expect(calls[0]).toMatchObject({
    path: '/api/v1/guest-auth/refresh',
    body: { refreshToken: pair.refreshToken },
  });
  expect(JSON.stringify(await r.json())).not.toContain('refresh');
});
test('missing cookie rejects without calling upstream', async () => {
  const r = await createSessionHandler({ kind: 'staff', baseUrl })(
    request('refresh', { refreshToken: pair.refreshToken }),
    'refresh',
  );
  expect(r.status).toBe(401);
  expect(calls).toHaveLength(0);
  expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
});
test.each([401, 429, 503])(
  'refresh failure %i clears cookie, sanitizes and never retries rotation',
  async (code) => {
    const handle = createSessionHandler({ kind: 'staff', baseUrl });
    const login = await handle(
      request('login', { username: 'synthetic', password: 'synthetic-password' }),
      'login',
    );
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    calls.length = 0;
    status = code;
    const r = await handle(request('refresh', undefined, { cookie }), 'refresh');
    expect(r.status).toBe(code);
    expect(calls).toHaveLength(1);
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    const text = await r.text();
    expect(text).not.toContain(pair.refreshToken);
    expect(text).not.toContain(pair.accessToken);
    if (code === 429) expect(r.headers.get('retry-after')).toBe('42');
  },
);
test.each([204, 401, 503])(
  'logout uses authenticated shared endpoint and clears cookie on %i',
  async (code) => {
    status = code;
    const r = await createSessionHandler({ kind: 'guest', baseUrl })(
      request('logout', undefined, { authorization: `Bearer ${pair.accessToken}` }),
      'logout',
    );
    expect(calls[0]).toMatchObject({
      path: '/api/v1/auth/logout',
      authorization: `Bearer ${pair.accessToken}`,
    });
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(r.status).toBe(code);
  },
);
test('malformed and oversized login are bounded validation failures', async () => {
  const handle = createSessionHandler({ kind: 'staff', baseUrl });
  for (const body of ['{', JSON.stringify({ username: 'x', password: 'x' }), 'x'.repeat(17000)]) {
    const r = await handle(
      new Request('https://ops.test/api/session/login', {
        method: 'POST',
        headers: { origin: 'https://ops.test', 'x-session-request': '1' },
        body,
      }),
      'login',
    );
    expect([400, 413]).toContain(r.status);
  }
  expect(calls).toHaveLength(0);
});
test('a malformed upstream token pair returns502 without exposing its payload', async () => {
  responseBody = {
    accessToken: 'bad',
    refreshToken: 'synthetic-private-invalid',
    extraSecret: 'must-not-escape',
  };
  const r = await createSessionHandler({ kind: 'staff', baseUrl })(
    request('login', { username: 'synthetic', password: 'synthetic-password' }),
    'login',
  );
  expect(r.status).toBe(502);
  expect(await r.text()).not.toContain('synthetic-private-invalid');
});
test('configured public origin authenticates through an internal Next URL and rejects host spoofing', async () => {
  const handle = createSessionHandler({ kind: 'staff', baseUrl, origin: 'https://public.test' });
  const body = JSON.stringify({ username: 'synthetic', password: 'synthetic-password' });
  const good = new Request('http://localhost:31002/api/session/login', {
    method: 'POST',
    headers: { origin: 'https://public.test', 'x-session-request': '1' },
    body,
  });
  expect((await handle(good, 'login')).status).toBe(200);
  const bad = new Request('https://evil.test/api/session/login', {
    method: 'POST',
    headers: { origin: 'https://evil.test', 'x-session-request': '1' },
    body,
  });
  expect((await handle(bad, 'login')).status).toBe(403);
});
test('missing optional mustChangePassword becomesfalse; GET requests are rejected', async () => {
  responseBody = {
    tokenType: pair.tokenType,
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresInSeconds: 900,
    refreshExpiresInSeconds: 604800,
  };
  const handle = createSessionHandler({ kind: 'staff', baseUrl });
  expect(
    await (
      await handle(
        request('login', { username: 'synthetic', password: 'synthetic-password' }),
        'login',
      )
    ).json(),
  ).toMatchObject({ mustChangePassword: false });
  expect(
    (await handle(new Request('https://ops.test/api/session/refresh'), 'refresh')).status,
  ).toBe(403);
});
test('development cookie flags follow configured loopback public origin behind Next', async () => {
  const handle = createSessionHandler({
    kind: 'staff',
    baseUrl,
    development: true,
    origin: 'http://127.0.0.1:31002',
  });
  const req = new Request('http://localhost:31002/api/session/login', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:31002', 'x-session-request': '1' },
    body: JSON.stringify({ username: 'synthetic', password: 'synthetic-password' }),
  });
  const response = await handle(req, 'login');
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).not.toContain('; Secure');
});
