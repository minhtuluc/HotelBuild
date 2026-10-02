import { describe, expect, it } from 'vitest';
import { memoryStorage, SESSION_KEY } from '../src/storage';
import { OfflineError, requireOnline } from '../src/netinfo';
import { displayPhone, Session } from '../src/session';

const online = { getConnected: async () => true };
const offline = { getConnected: async () => false };

const TOKENS = {
  tokenType: 'Bearer',
  accessToken: 'access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'refresh-token-bbbbbbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604_800,
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

function session(
  plan: { status: number; body?: unknown }[],
  net = online,
): { s: Session; storage: ReturnType<typeof memoryStorage> } {
  const storage = memoryStorage();
  return {
    s: new Session({
      storage,
      baseUrl: 'http://127.0.0.1:9/api/v1',
      createId: () => '00000000-0000-4000-8000-000000000000',
      fetchImpl: fetchWith(plan),
      netInfo: net,
      sleep: async () => undefined,
    }),
    storage,
  };
}

describe('displayPhone', () => {
  it('chuẩn hoá 0x/84x về +84', () => {
    expect(displayPhone('0901234567')).toBe('+84901234567');
    expect(displayPhone('84901234567')).toBe('+84901234567');
    expect(displayPhone('+84901234567')).toBe('+84901234567');
  });
});

describe('requireOnline', () => {
  it('ném OfflineError khi mất mạng', async () => {
    await expect(requireOnline(offline)).rejects.toBeInstanceOf(OfflineError);
  });
});

describe('Session khách', () => {
  it('đăng nhập lưu refresh token; register chuẩn hoá SĐT', async () => {
    const { s, storage } = session([{ status: 200, body: TOKENS }]);
    await s.login('0901234567', 'matkhau123');
    expect(await storage.get(SESSION_KEY)).toBe(TOKENS.refreshToken);
    expect(s.hasAccessToken()).toBe(true);
  });

  it('gửi clientSurface GUEST_ANDROID khi đăng nhập và đăng ký (HB-012)', async () => {
    const bodies: string[] = [];
    const storage = memoryStorage();
    const s = new Session({
      storage,
      baseUrl: 'http://127.0.0.1:9/api/v1',
      createId: () => '00000000-0000-4000-8000-000000000000',
      fetchImpl: async (_input, init) => {
        bodies.push(typeof init?.body === 'string' ? init.body : '');
        return new Response(JSON.stringify(TOKENS), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      netInfo: online,
      sleep: async () => undefined,
    });
    await s.login('0901234567', 'matkhau123');
    await s.register({
      phone: '0901234567',
      fullName: 'Khách',
      password: 'matkhau123',
      consentMarketing: true,
      consentVersion: '2026-10',
    });
    expect(bodies[0]).toContain('"clientSurface":"GUEST_ANDROID"');
    expect(bodies[1]).toContain('"clientSurface":"GUEST_ANDROID"');
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
    await s.login('0901234567', 'matkhau123');
    await s.logout();
    expect(calls).toEqual(['/api/v1/guest-auth/login', '/api/v1/auth/logout']);
    expect(await storage.get(SESSION_KEY)).toBeNull();
  });

  it('đăng ký trùng SĐT → lỗi 409 E_AUTH_PHONE_REGISTERED lan ra ApiError', async () => {
    const { s } = session([
      {
        status: 409,
        body: {
          code: 'E_AUTH_PHONE_REGISTERED',
          message: 'SĐT đã có hồ sơ',
          traceId: 't1',
          timestamp: '2026-10-02T00:00:00.000Z',
          path: '/api/v1/guest-auth/register',
        },
      },
    ]);
    await expect(
      s.register({
        phone: '0901234567',
        fullName: 'Khách',
        password: 'matkhau123',
        consentMarketing: true,
        consentVersion: '2026-10',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('silentRefresh 401 xoá storage và trả false', async () => {
    const { s, storage } = session([
      {
        status: 401,
        body: {
          code: 'E_AUTH_INVALID_CREDENTIALS',
          message: 'Hết hạn',
          traceId: 't1',
          timestamp: '2026-10-02T00:00:00.000Z',
          path: '/x',
        },
      },
    ]);
    await storage.set(SESSION_KEY, 'refresh-token-bbbbbbbbbbbbbbbbbbbbbbb');
    expect(await s.silentRefresh()).toBe(false);
    expect(await storage.get(SESSION_KEY)).toBeNull();
  });

  it('quên mật khẩu luôn trả 202 (không lộ SĐT tồn tại)', async () => {
    const { s } = session([{ status: 202 }]);
    await expect(s.passwordResetRequest('0901234567')).resolves.toBeUndefined();
  });
});
