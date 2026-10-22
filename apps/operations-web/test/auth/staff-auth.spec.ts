import { afterEach, expect, test, vi } from 'vitest';
import { StaffLoginError, createStaffAuth, type StaffAuth } from '../../src/session/staff-auth';
import {
  installOpsBrowser,
  issuedSession,
  refusedSession,
  type OpsBrowser,
} from '../session-harness';

/** Môi trường trình duyệt tối thiểu của HB-201 (Web Locks, localStorage, fetch) + `createSessionClient` thật. */
let browser: OpsBrowser;
let auth: StaffAuth | undefined;

afterEach(() => {
  auth?.dispose();
  auth = undefined;
  browser.reset();
});

const failure = (status: number, code: string, headers: Record<string, string> = {}) =>
  Response.json(
    {
      code,
      message: 'Synthetic',
      traceId: 't',
      timestamp: '2026-10-22T00:00:00Z',
      path: '/api/session/login',
    },
    { status, headers },
  );

test('login publishes the session: a token is available with no further request', async () => {
  const bodies: unknown[] = [];
  browser = installOpsBrowser(async (_input, init) => {
    bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
    return issuedSession();
  });
  auth = createStaffAuth();
  await expect(auth.login('letan01', 'Synthetic-password')).resolves.toEqual({
    mustChangePassword: false,
  });
  expect(bodies).toEqual([{ username: 'letan01', password: 'Synthetic-password' }]);
  expect(await auth.getAccessToken()).toBe('synthetic-access-ops');
  expect(browser.calls).toEqual(['/api/session/login']);
});

test('the server flag mustChangePassword is passed through', async () => {
  browser = installOpsBrowser(async () =>
    Response.json({
      accessToken: 'synthetic-access-ops',
      expiresInSeconds: 900,
      mustChangePassword: true,
    }),
  );
  auth = createStaffAuth();
  await expect(auth.login('letan01', 'Synthetic-password')).resolves.toEqual({
    mustChangePassword: true,
  });
});

test.each([
  [401, 'E_AUTH_INVALID_CREDENTIALS', {}, { kind: 'invalid' }],
  [401, 'E_AUTH_ACCOUNT_LOCKED', { 'retry-after': '42' }, { kind: 'locked', waitSeconds: 42 }],
  [429, 'E_GEN_RATE_LIMITED', { 'retry-after': '30' }, { kind: 'rateLimited', waitSeconds: 30 }],
  [429, 'E_GEN_RATE_LIMITED', {}, { kind: 'rateLimited' }],
  [502, 'E_GEN_SERVICE_UNAVAILABLE', {}, { kind: 'network' }],
])(
  'login %s %s is a typed failure with the Retry-After the BFF sent',
  async (status, code, headers, expected) => {
    browser = installOpsBrowser(async () => failure(status, code, headers));
    auth = createStaffAuth();
    const error = await auth
      .login('letan01', 'Synthetic-password')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StaffLoginError);
    expect(error instanceof StaffLoginError && error.failure).toEqual(expected);
  },
);

test('a network failure while logging in is a typed network failure', async () => {
  browser = installOpsBrowser(async () => {
    throw new TypeError('Failed to fetch');
  });
  auth = createStaffAuth();
  const error = await auth
    .login('letan01', 'Synthetic-password')
    .catch((caught: unknown) => caught);
  expect(error instanceof StaffLoginError && error.failure).toEqual({ kind: 'network' });
});

test('a stale Retry-After from an earlier failure never leaks into a later one', async () => {
  let call = 0;
  browser = installOpsBrowser(async () =>
    ++call === 1
      ? failure(429, 'E_GEN_RATE_LIMITED', { 'retry-after': '30' })
      : failure(429, 'E_GEN_RATE_LIMITED'),
  );
  auth = createStaffAuth();
  await auth.login('letan01', 'Synthetic-password').catch(() => undefined);
  const second = await auth
    .login('letan01', 'Synthetic-password')
    .catch((caught: unknown) => caught);
  expect(second instanceof StaffLoginError && second.failure).toEqual({ kind: 'rateLimited' });
});

test('logout calls the BFF with the bearer and leaves no token behind', async () => {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  browser = installOpsBrowser(async (input, init) => {
    seen.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return String(input).endsWith('/logout')
      ? new Response(null, { status: 204 })
      : issuedSession();
  });
  const expired = vi.fn();
  auth = createStaffAuth({ onExpired: expired });
  await auth.login('letan01', 'Synthetic-password');
  await auth.logout();
  expect(seen.at(-1)).toEqual({
    url: '/api/session/logout',
    authorization: 'Bearer synthetic-access-ops',
  });
  expect(await auth.getAccessToken()).toBeNull();
});

test('logout still clears the local session when the BFF call fails', async () => {
  browser = installOpsBrowser(async (input) =>
    String(input).endsWith('/logout')
      ? failure(401, 'E_AUTH_INVALID_CREDENTIALS')
      : issuedSession(),
  );
  auth = createStaffAuth({ onExpired: () => undefined });
  await auth.login('letan01', 'Synthetic-password');
  await expect(auth.logout()).resolves.toBeUndefined();
  expect(await auth.getAccessToken()).toBeNull();
});

test('with no cookie the refresh is refused: no token and onExpired fires exactly once', async () => {
  browser = installOpsBrowser(async () => refusedSession());
  const expired = vi.fn();
  auth = createStaffAuth({ onExpired: expired });
  expect(await auth.getAccessToken()).toBeNull();
  expect(await auth.getAccessToken()).toBeNull();
  expect(expired).toHaveBeenCalledTimes(1);
});
