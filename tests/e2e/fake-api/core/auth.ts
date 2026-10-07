import type { FakeHandler, FakeRequest, FakeResponse } from './types.js';
interface Actor {
  key: string;
  sequence: number;
  refreshCount: number;
  logoutCount: number;
  status: number;
  delayMs: number;
  revoked: boolean;
  refresh: string;
  access: string;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function error(status: number, path: string): FakeResponse {
  return {
    status,
    headers: { 'retry-after': '42' },
    body: {
      code:
        status === 429
          ? 'E_GEN_RATE_LIMITED'
          : status === 423
            ? 'E_AUTH_ACCOUNT_LOCKED'
            : 'E_AUTH_INVALID_CREDENTIALS',
      message: 'Synthetic auth failure',
      traceId: 'fake-session-trace',
      timestamp: '2026-10-07T00:00:00.000Z',
      path,
      retryAfterSeconds: 42,
    },
  };
}
function issue(actor: Actor) {
  actor.sequence++;
  actor.access = `synthetic-access-${actor.key}-${actor.sequence}`;
  actor.refresh = `synthetic-refresh-${actor.key}-${actor.sequence}`;
  return {
    tokenType: 'Bearer',
    accessToken: actor.access,
    refreshToken: actor.refresh,
    expiresInSeconds: 900,
    refreshExpiresInSeconds: 604800,
    mustChangePassword: false,
  };
}
export function createHandler(): FakeHandler {
  const actors = new Map<string, Actor>();
  const tokens = new Map<string, Actor>();
  function actor(key: string): Actor {
    let value = actors.get(key);
    if (!value) {
      value = {
        key,
        sequence: 0,
        refreshCount: 0,
        logoutCount: 0,
        status: 200,
        delayMs: 0,
        revoked: false,
        refresh: '',
        access: '',
      };
      actors.set(key, value);
    }
    return value;
  }
  function control(request: FakeRequest): FakeResponse {
    const state = actor(decodeURIComponent(request.url.pathname.slice('/__control/'.length)));
    if (request.method === 'POST' && object(request.body)) {
      state.status = typeof request.body.status === 'number' ? request.body.status : 200;
      state.delayMs =
        typeof request.body.delayMs === 'number'
          ? Math.min(1000, Math.max(0, request.body.delayMs))
          : 0;
    }
    return {
      status: 200,
      body: {
        status: state.status,
        refreshCount: state.refreshCount,
        logoutCount: state.logoutCount,
      },
    };
  }
  return async (request) => {
    const path = request.url.pathname;
    if (path.startsWith('/__control/')) return control(request);
    if (path === '/api/v1/system/health') return { status: 200, body: { status: 'ok' } };
    if (request.method !== 'POST' || !object(request.body)) {
      if (path === '/api/v1/auth/logout' && request.method === 'POST') {
        const state = [...actors.values()].find(
          (value) => `Bearer ${value.access}` === request.authorization,
        );
        if (!state) return error(401, path);
        state.logoutCount++;
        state.revoked = true;
        return state.status === 200 ? { status: 204 } : error(state.status, path);
      }
      return undefined;
    }
    if (path === '/api/v1/auth/login' || path === '/api/v1/guest-auth/login') {
      const key = path.includes('guest-auth') ? request.body.phone : request.body.username;
      if (typeof key !== 'string') return error(400, path);
      const state = actor(key);
      if (state.status !== 200) return error(state.status, path);
      state.revoked = false;
      const body = issue(state);
      tokens.set(state.refresh, state);
      return { status: 200, body };
    }
    if (path === '/api/v1/auth/refresh' || path === '/api/v1/guest-auth/refresh') {
      const token = request.body.refreshToken;
      const state = typeof token === 'string' ? tokens.get(token) : undefined;
      if (!state) return error(401, path);
      state.refreshCount++;
      await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      if (token !== state.refresh || state.revoked) {
        state.revoked = true;
        return error(401, path);
      }
      if (state.status !== 200) return error(state.status, path);
      const body = issue(state);
      tokens.set(state.refresh, state);
      return { status: 200, body };
    }
    return undefined;
  };
}
