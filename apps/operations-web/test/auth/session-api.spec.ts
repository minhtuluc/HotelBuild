import { expect, test } from 'vitest';
import { ApiClient, ApiError } from '@pinehill/api-client';
import {
  changePassword,
  loadProfile,
  loadProperties,
  propertiesForGate,
} from '../../src/session/api';

const meBody = {
  userId: 'u1',
  username: 'letan01',
  fullName: 'Lễ tân',
  role: 'FRONT_DESK',
  propertyScope: ['p1'],
  hasPin: true,
  mustChangePassword: false,
};
const property = (id: string) => ({
  id,
  name: `Cơ sở ${id}`,
  status: 'ACTIVE',
  activeRoomCount: 10,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 1,
});
const page = (ids: string[], next: string | null) => ({
  data: ids.map(property),
  meta: { limit: 100, total: ids.length, hasMore: next !== null, nextCursor: next },
});

function client(handler: (url: URL, init?: RequestInit) => Response) {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const api = new ApiClient({
    baseUrl: 'http://ops.test/api/session/sys',
    getAccessToken: () => 'synthetic-access-ops',
    maxAttempts: 1,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      return handler(url, init);
    },
  });
  return { api, calls };
}

test('loadProfile reads GET /auth/me through the BFF and validates it', async () => {
  const { api, calls } = client(() => Response.json(meBody));
  expect(await loadProfile(api)).toEqual(meBody);
  expect(calls[0]?.url.pathname).toBe('/api/session/sys/auth/me');
});

test('loadProfile maps 403 E_AUTH_PASSWORD_CHANGE_REQUIRED to a mustChangePassword profile (TD-69)', async () => {
  const { api } = client(() =>
    Response.json(
      {
        code: 'E_AUTH_PASSWORD_CHANGE_REQUIRED',
        message: 'Bắt buộc đổi mật khẩu.',
        traceId: 't',
        timestamp: '2026-10-31T00:00:00.000Z',
        path: '/api/v1/auth/me',
      },
      { status: 403 },
    ),
  );
  const profile = await loadProfile(api);
  expect(profile.mustChangePassword).toBe(true);
});

test('loadProfile rejects a body that is not a profile', async () => {
  const { api } = client(() => Response.json({ userId: 'u1' }));
  await expect(loadProfile(api)).rejects.toBeInstanceOf(ApiError);
});

test('loadProperties follows cursors and returns names for the chooser', async () => {
  const { api, calls } = client((url) =>
    url.searchParams.get('cursor') === null
      ? Response.json(page(['p1', 'p2'], 'c2'))
      : Response.json(page(['p3'], null)),
  );
  expect(await loadProperties(api)).toEqual([
    { id: 'p1', name: 'Cơ sở p1' },
    { id: 'p2', name: 'Cơ sở p2' },
    { id: 'p3', name: 'Cơ sở p3' },
  ]);
  expect(calls.map((call) => call.url.search)).toEqual(['?limit=100', '?limit=100&cursor=c2']);
});

test('loadProperties refuses a server that loops its cursor or never ends (no partial list)', async () => {
  const looping = client(() => Response.json(page(['p1'], 'same')));
  await expect(loadProperties(looping.api)).rejects.toBeInstanceOf(ApiError);
  expect(looping.calls.length).toBeLessThanOrEqual(3);
  let n = 0;
  const endless = client(() => Response.json(page(['p1'], `c${++n}`)));
  await expect(loadProperties(endless.api)).rejects.toBeInstanceOf(ApiError);
  expect(endless.calls.length).toBeLessThanOrEqual(10);
});

test('changePassword POSTs the contract body with the BFF marker header and one attempt', async () => {
  const { api, calls } = client(() => new Response(null, { status: 204 }));
  await changePassword(api, { currentPassword: 'old-password', newPassword: 'new-password-1' });
  const call = calls[0]!;
  expect(call.url.pathname).toBe('/api/session/sys/auth/change-password');
  expect(call.init?.method).toBe('POST');
  expect(new Headers(call.init?.headers).get('x-session-request')).toBe('1');
  expect(JSON.parse(String(call.init?.body))).toEqual({
    currentPassword: 'old-password',
    newPassword: 'new-password-1',
  });
});

test('changePassword refuses a body outside the contract before any request', async () => {
  const { api, calls } = client(() => new Response(null, { status: 204 }));
  await expect(
    changePassword(api, { currentPassword: 'old-password', newPassword: 'short' }),
  ).rejects.toThrow();
  expect(calls).toEqual([]);
});

const gateMe = (over: Partial<Parameters<typeof propertiesForGate>[1]> = {}) => ({
  role: 'FRONT_DESK' as const,
  propertyScope: ['p1'],
  mustChangePassword: false,
  ...over,
});

test('propertiesForGate loads nothing for one-property staff or while a password change is due', async () => {
  const { api, calls } = client(() => Response.json(page(['p1'], null)));
  expect(await propertiesForGate(api, gateMe())).toBeNull();
  expect(
    await propertiesForGate(api, gateMe({ role: 'OWNER', mustChangePassword: true })),
  ).toBeNull();
  expect(calls).toEqual([]);
});

test('propertiesForGate loads names for OWNER and for multi-property staff', async () => {
  const { api } = client(() => Response.json(page(['p1', 'p2'], null)));
  const names = [
    { id: 'p1', name: 'Cơ sở p1' },
    { id: 'p2', name: 'Cơ sở p2' },
  ];
  expect(await propertiesForGate(api, gateMe({ role: 'OWNER', propertyScope: [] }))).toEqual(names);
  expect(
    await propertiesForGate(api, gateMe({ role: 'MANAGER', propertyScope: ['p1', 'p2'] })),
  ).toEqual(names);
});

test('a failed list falls back to the server scope, but never hides a real problem', async () => {
  const failing = client(() => Response.json({ code: 'E_X' }, { status: 500 }));
  expect(
    await propertiesForGate(failing.api, gateMe({ role: 'MANAGER', propertyScope: ['p1', 'p2'] })),
  ).toBeNull();
  // OWNER without any scope has nothing to fall back to: the failure surfaces for a retry.
  await expect(
    propertiesForGate(failing.api, gateMe({ role: 'OWNER', propertyScope: [] })),
  ).rejects.toBeInstanceOf(ApiError);
  // A dead session (401) is never papered over.
  const expired = client(() =>
    Response.json({ code: 'E_AUTH_INVALID_CREDENTIALS' }, { status: 401 }),
  );
  await expect(
    propertiesForGate(expired.api, gateMe({ role: 'MANAGER', propertyScope: ['p1', 'p2'] })),
  ).rejects.toMatchObject({ status: 401 });
});
