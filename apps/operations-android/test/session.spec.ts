import { describe, expect, it } from 'vitest';
import { memoryStorage, SESSION_KEY } from '../src/storage';
import { OfflineError, requireOnline } from '../src/netinfo';
import { Session } from '../src/session';

const online = { getConnected: async () => true };
const offline = { getConnected: async () => false };

const TOKENS = {
  tokenType: 'Bearer',
  accessToken: 'access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'refresh-token-bbbbbbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604_800,
};

const PIN = {
  pinToken: 'pin-token-cccccccccccccccc',
  expiresAt: '2026-10-02T00:05:00.000Z',
};

function fetchWith(plan: { status: number; body?: unknown }[]): typeof fetch {
  let index = 0;
  return async () => {
    const step = plan[Math.min(index, plan.length - 1)] ?? { status: 200 };
    index += 1;
    return new Response(step.body === undefined ? null : JSON.stringify(step.body), {
      status: step.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function session(plan: { status: number; body?: unknown }[], net = online): Session {
  return new Session({
    storage: memoryStorage(),
    baseUrl: 'http://127.0.0.1:9/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    fetchImpl: fetchWith(plan),
    netInfo: net,
    sleep: async () => undefined,
  });
}

describe('storage', () => {
  it('set/get/remove vòng đời đầy đủ', async () => {
    const storage = memoryStorage();
    await storage.set('k', 'v');
    expect(await storage.get('k')).toBe('v');
    await storage.remove('k');
    expect(await storage.get('k')).toBeNull();
  });
});

describe('requireOnline', () => {
  it('ném OfflineError khi mất mạng', async () => {
    await expect(requireOnline(offline)).rejects.toBeInstanceOf(OfflineError);
    await expect(requireOnline(online)).resolves.toBeUndefined();
  });
});

describe('Session', () => {
  it('login lưu refresh token vào storage, access chỉ trong bộ nhớ', async () => {
    const storage = memoryStorage();
    const s = new Session({
      storage,
      baseUrl: 'http://127.0.0.1:9/api/v1',
      createId: () => '00000000-0000-4000-8000-000000000000',
      fetchImpl: fetchWith([{ status: 200, body: TOKENS }]),
      netInfo: online,
      sleep: async () => undefined,
    });
    const outcome = await s.login('owner', 'matkhau123');
    expect(outcome.mustChangePassword).toBe(false);
    expect(await storage.get(SESSION_KEY)).toBe(TOKENS.refreshToken);
    expect(s.hasAccessToken()).toBe(true);
  });

  it('login ngoại tuyến ném OfflineError, không gửi request', async () => {
    const s = session([{ status: 200, body: TOKENS }], offline);
    await expect(s.login('owner', 'matkhau123')).rejects.toBeInstanceOf(OfflineError);
  });

  it('silentRefresh: không token → false; 200 → true; 401 → xoá storage và false', async () => {
    const storage = memoryStorage();
    const make = (plan: { status: number; body?: unknown }[]) =>
      new Session({
        storage,
        baseUrl: 'http://127.0.0.1:9/api/v1',
        createId: () => '00000000-0000-4000-8000-000000000000',
        fetchImpl: fetchWith(plan),
        netInfo: online,
        sleep: async () => undefined,
      });

    const empty = make([]);
    expect(await empty.silentRefresh()).toBe(false);

    await storage.set(SESSION_KEY, 'refresh-token-bbbbbbbbbbbbbbbbbbbbbbb');
    const ok = make([{ status: 200, body: TOKENS }]);
    expect(await ok.silentRefresh()).toBe(true);
    expect(await storage.get(SESSION_KEY)).toBe(TOKENS.refreshToken);

    const unauthorized = make([
      {
        status: 401,
        body: {
          code: 'E_AUTH_INVALID_CREDENTIALS',
          message: 'Phiên hết hạn',
          traceId: 't1',
          timestamp: '2026-10-02T00:00:00.000Z',
          path: '/api/v1/auth/refresh',
        },
      },
    ]);
    expect(await unauthorized.silentRefresh()).toBe(false);
    expect(await storage.get(SESSION_KEY)).toBeNull();
  });

  it('verifyPin trả pinToken và không ghi xuống storage', async () => {
    const storage = memoryStorage();
    const s = new Session({
      storage,
      baseUrl: 'http://127.0.0.1:9/api/v1',
      createId: () => '00000000-0000-4000-8000-000000000000',
      fetchImpl: fetchWith([{ status: 200, body: PIN }]),
      netInfo: online,
      sleep: async () => undefined,
    });
    expect(await s.verifyPin('123456')).toBe(PIN.pinToken);
    expect(await storage.get(SESSION_KEY)).toBeNull();
  });

  it('profile() đọc /auth/me để biết hasPin, propertyScope, mustChangePassword (HB-012)', async () => {
    const storage = memoryStorage();
    const s = new Session({
      storage,
      baseUrl: 'http://127.0.0.1:9/api/v1',
      createId: () => '00000000-0000-4000-8000-000000000000',
      fetchImpl: fetchWith([
        { status: 200, body: TOKENS },
        {
          status: 200,
          body: {
            userId: 'u1',
            username: 'letan01',
            fullName: 'Lễ tân 01',
            role: 'FRONT_DESK',
            propertyScope: ['p1', 'p2'],
            hasPin: false,
            mustChangePassword: false,
          },
        },
      ]),
      netInfo: online,
      sleep: async () => undefined,
    });
    await s.login('letan01', 'matkhau123');
    const profile = await s.profile();
    expect(profile.propertyScope).toHaveLength(2);
    expect(profile.hasPin).toBe(false);
    s.selectProperty('p2');
    expect(s.selectedProperty()).toBe('p2');
  });

  it('logout gọi /auth/logout trước rồi luôn xoá storage (HB-012)', async () => {
    const storage = memoryStorage();
    const calls: string[] = [];
    const s = new Session({
      storage,
      baseUrl: 'http://127.0.0.1:9/api/v1',
      createId: () => '00000000-0000-4000-8000-000000000000',
      fetchImpl: async (input) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        calls.push(new URL(url).pathname);
        const isLogin = calls.length === 1;
        return new Response(isLogin ? JSON.stringify(TOKENS) : null, {
          status: isLogin ? 200 : 204,
          headers: { 'content-type': 'application/json' },
        });
      },
      netInfo: online,
      sleep: async () => undefined,
    });
    await s.login('letan01', 'matkhau123');
    await s.logout();
    expect(calls).toEqual(['/api/v1/auth/login', '/api/v1/auth/logout']);
    expect(await storage.get(SESSION_KEY)).toBeNull();
  });
});
