import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { POST as login } from '../../src/app/api/session/login/route';
import { POST as refresh } from '../../src/app/api/session/refresh/route';
import { POST as logout } from '../../src/app/api/session/logout/route';
delete process.env.SESSION_APP_ORIGIN;
const paths: string[] = [];
const server = createServer((req, res) => {
  paths.push(req.url ?? '');
  req.resume();
  res.writeHead(req.url?.endsWith('/logout') ? 204 : 200, { 'content-type': 'application/json' });
  res.end(
    req.url?.endsWith('/logout')
      ? undefined
      : JSON.stringify({
          tokenType: 'Bearer',
          accessToken: 'synthetic-access-token-0001',
          refreshToken: 'synthetic-refresh-token-0001',
          expiresInSeconds: 900,
          refreshExpiresInSeconds: 604800,
        }),
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('No port');
  process.env.NEXT_PUBLIC_API_BASE_URL = `http://127.0.0.1:${addr.port}/api/v1`;
  function req(action: string, body?: unknown, headers: Record<string, string> = {}) {
    return new Request(`https://app.test/api/session/${action}`, {
      method: 'POST',
      headers: { origin: 'https://app.test', 'x-session-request': '1', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const response = await login(
    req('login', { phone: '+84912345678', password: 'synthetic-password' }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes('refresh'), false);
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.equal((await refresh(req('refresh', undefined, { cookie }))).status, 200);
  assert.equal(
    (
      await logout(
        req('logout', undefined, { authorization: 'Bearer synthetic-access-token-0001' }),
      )
    ).headers
      .get('set-cookie')
      ?.includes('Max-Age=0'),
    true,
  );
  assert.deepEqual(paths, [
    '/api/v1/guest-auth/login',
    '/api/v1/guest-auth/refresh',
    '/api/v1/auth/logout',
  ]);
  const csrf = await refresh(req('refresh', undefined, { origin: 'https://evil.test' }));
  assert.equal(csrf.status, 403);
  assert.equal(csrf.headers.get('set-cookie'), null);
  assert.equal(paths.length, 3);
  process.stdout.write(
    JSON.stringify({ login: true, refresh: true, logout: true, csrf: true, secretsFiltered: true }),
  );
} finally {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
