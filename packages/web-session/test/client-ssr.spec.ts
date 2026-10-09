import { afterEach, expect, test, vi } from 'vitest';
import { createSessionClient } from '../src/client.js';
const clients: ReturnType<typeof createSessionClient>[] = [];
afterEach(() => {
  clients.forEach((client) => client.dispose());
  clients.length = 0;
  vi.unstubAllGlobals();
});
function client() {
  const value = createSessionClient({ kind: 'guest', onExpired: () => undefined });
  clients.push(value);
  return value;
}
test('SSR construction and disposal need no browser APIs or network', () => {
  vi.stubGlobal('navigator', undefined);
  vi.stubGlobal('localStorage', undefined);
  vi.stubGlobal('BroadcastChannel', undefined);
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  expect(() => client().dispose()).not.toThrow();
  expect(network).not.toHaveBeenCalled();
});
test('the browser coordinator starts on first session operation after construction', async () => {
  vi.stubGlobal('navigator', undefined);
  vi.stubGlobal('localStorage', undefined);
  const network = vi.fn(async () =>
    Response.json({
      accessToken: 'synthetic-access-token-lazy',
      expiresInSeconds: 900,
      mustChangePassword: false,
    }),
  );
  vi.stubGlobal('fetch', network);
  const value = client();
  expect(network).not.toHaveBeenCalled();
  const stored = new Map<string, string>();
  const lock = vi.fn(async (_name: string, task: () => Promise<unknown>) => task());
  vi.stubGlobal('navigator', { locks: { request: lock } });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, revision: string) => stored.set(key, revision),
  });
  // The fetch implementation is captured at creation, like the real browser.
  const issued = await value.getAccessToken();
  expect(issued).toBe('synthetic-access-token-lazy');
  expect(network).toHaveBeenCalledTimes(1);
  expect(lock).toHaveBeenCalledTimes(1);
});
test('unsupported browsers still reject session operations before any HTTP call', async () => {
  vi.stubGlobal('navigator', undefined);
  const value = client();
  await expect(value.getAccessToken()).rejects.toThrow('Web Locks');
});
test('disposing an unused client never initializes browser coordination later', async () => {
  vi.stubGlobal('navigator', undefined);
  const value = client();
  value.dispose();
  expect(await value.getAccessToken()).toBeNull();
  expect(await value.onUnauthorized()).toBe(false);
  await expect(value.login({})).rejects.toThrow('disposed');
});
