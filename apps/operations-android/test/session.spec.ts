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
});
