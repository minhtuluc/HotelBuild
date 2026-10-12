import { afterEach, expect, test } from 'vitest';
import { createSessionClient } from '../src/client.js';
import { SessionCoordinator, type LockHost } from '../src/coordinator.js';

const clients: ReturnType<typeof createSessionClient>[] = [];
const coordinators: SessionCoordinator[] = [];
afterEach(() => {
  clients.forEach((c) => c.dispose());
  coordinators.forEach((c) => c.dispose());
  clients.length = 0;
  coordinators.length = 0;
});
function environment() {
  const values = new Map<string, string>();
  let queue = Promise.resolve();
  const locks: LockHost = {
    async run<T>(_name: string, task: () => Promise<T>): Promise<T> {
      const previous = queue;
      let release: () => void = () => undefined;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
  const name = crypto.randomUUID();
  return {
    values,
    create: () => {
      const c = new SessionCoordinator({
        name,
        locks,
        storage: {
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => {
            values.set(key, value);
          },
        },
        channel: new BroadcastChannel(name),
        peerTimeoutMs: 30,
      });
      coordinators.push(c);
      return c;
    },
  };
}
function setup(coordinator?: SessionCoordinator) {
  let sequence = 0,
    refreshes = 0,
    expired = 0,
    fail = false,
    clock = 100000;
  const calls: { path: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = String(input);
    calls.push({ path, headers: new Headers(init?.headers) });
    if (path.endsWith('/logout')) return new Response(null, { status: 204 });
    if (path.endsWith('/refresh')) refreshes++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (fail)
      return Response.json(
        {
          code: 'E_AUTH_INVALID_CREDENTIALS',
          message: 'synthetic',
          traceId: 't',
          timestamp: '2026-10-07T00:00:00.000Z',
          path,
        },
        { status: 401 },
      );
    return Response.json({
      accessToken: `synthetic-access-token-${++sequence}`,
      expiresInSeconds: 900,
      mustChangePassword: false,
    });
  };
  const client = createSessionClient({
    kind: 'staff',
    coordinator: coordinator ?? environment().create(),
    fetchImpl,
    now: () => clock,
    onExpired: () => {
      expired++;
    },
  });
  clients.push(client);
  return {
    client,
    calls,
    refreshes: () => refreshes,
    expired: () => expired,
    advance: (ms: number) => {
      clock += ms;
    },
    fail: () => {
      fail = true;
    },
  };
}
test('login exposes an in-memory token and never persists credentials or tokens', async () => {
  const env = environment(),
    s = setup(env.create());
  const pair = await s.client.login({ username: 'synthetic', password: 'synthetic-password' });
  expect(await s.client.getAccessToken()).toBe(pair.accessToken);
  const stored = JSON.stringify([...env.values.values()]);
  expect(stored).not.toContain(pair.accessToken);
  expect(stored).not.toContain('password');
  expect(stored).not.toContain('refresh');
  expect(s.calls[0]?.headers.get('x-session-request')).toBe('1');
  expect(s.refreshes()).toBe(0);
});
test('40 simultaneous cold token requests use one refresh', async () => {
  const s = setup();
  const tokens = await Promise.all(Array.from({ length: 40 }, () => s.client.getAccessToken()));
  expect(s.refreshes()).toBe(1);
  expect(new Set(tokens).size).toBe(1);
  expect(tokens[0]).not.toBeNull();
});
test('refreshes before expiry and handles old delayed401 without rotating again', async () => {
  const s = setup();
  const old = await s.client.getAccessToken();
  s.advance(875000);
  const current = await s.client.getAccessToken();
  expect(current).not.toBe(old);
  expect(s.refreshes()).toBe(2);
  expect(await s.client.onUnauthorized(old ?? undefined)).toBe(true);
  expect(s.refreshes()).toBe(2);
  expect(await s.client.onUnauthorized(current ?? undefined)).toBe(true);
  expect(s.refreshes()).toBe(3);
});
test('refresh failure clears state and emits session-expired once for a concurrent batch', async () => {
  const s = setup();
  await s.client.login({});
  s.fail();
  const results = await Promise.all(Array.from({ length: 20 }, () => s.client.onUnauthorized()));
  expect(results.every((value) => !value)).toBe(true);
  expect(s.expired()).toBe(1);
  expect(s.refreshes()).toBe(1);
});
test('two coordinators share one rotation and logout invalidates both tabs', async () => {
  const env = environment(),
    a = setup(env.create()),
    b = setup(env.create());
  const tokens = await Promise.all([a.client.getAccessToken(), b.client.getAccessToken()]);
  expect(tokens[0]).not.toBeNull();
  expect(tokens[0]).toBe(tokens[1]);
  expect(a.refreshes() + b.refreshes()).toBe(1);
  await a.client.logout();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(b.expired()).toBe(1);
  expect(a.calls.at(-1)?.headers.get('authorization')).toBe(`Bearer ${tokens[0]}`);
});
test('late channel state cannot resurrect a cleared revision', async () => {
  const env = environment(),
    a = env.create(),
    b = env.create();
  const state = {
    accessToken: 'synthetic-access-token-0001',
    expiresInSeconds: 900,
    mustChangePassword: false,
    expiresAt: 1000000,
  };
  a.publish(state);
  b.publish(undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(a.current()).toBeUndefined();
  expect(b.current()).toBeUndefined();
});
test('a failed rotation is not repeated by a waiting tab', async () => {
  const env = environment(),
    a = setup(env.create()),
    b = setup(env.create());
  const issued = await a.client.login({});
  await b.client.getAccessToken();
  a.fail();
  b.fail();
  const results = await Promise.all([
    a.client.onUnauthorized(issued.accessToken),
    b.client.onUnauthorized(issued.accessToken),
  ]);
  expect(results).toEqual([false, false]);
  expect(a.refreshes() + b.refreshes()).toBe(1);
  expect(a.expired()).toBe(1);
  expect(b.expired()).toBe(1);
});
test('a newly opened tab obtains the existing access token for logout', async () => {
  const env = environment(),
    a = setup(env.create());
  const issued = await a.client.login({});
  const b = setup(env.create());
  await b.client.logout();
  expect(b.calls.at(-1)?.headers.get('authorization')).toBe(`Bearer ${issued.accessToken}`);
  expect(b.refreshes()).toBe(0);
});
test('composition is notified of token changes and logout without persisting token', async () => {
  const env = environment();
  const coordinator = env.create();
  const changes: (string | null)[] = [];
  coordinator.publish({
    accessToken: 'synthetic-owner1',
    expiresInSeconds: 600,
    expiresAt: Date.now() + 600000,
    mustChangePassword: false,
  });
  const client = createSessionClient({
    kind: 'staff',
    coordinator,
    onExpired: () => {},
    onSessionChanged: (token) => changes.push(token),
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  clients.push(client);
  await client.getAccessToken();
  coordinator.publish({
    accessToken: 'synthetic-owner2',
    expiresInSeconds: 600,
    expiresAt: Date.now() + 600000,
    mustChangePassword: false,
  });
  await client.logout();
  expect(changes).toEqual(['synthetic-owner2', null]);
  expect([...env.values.values()].join('')).not.toContain('synthetic-owner2');
});
