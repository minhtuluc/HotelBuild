import { beforeAll, afterAll, expect, test } from 'vitest';
import { startFakeApi } from '../../../tests/e2e/fake-api/server.js';
import { tokenPairSchema } from '@pinehill/contracts';
let api: Awaited<ReturnType<typeof startFakeApi>>;
beforeAll(async () => {
  api = await startFakeApi('http://127.0.0.1:0/api/v1');
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    api.server.close((e) => (e ? reject(e) : resolve())),
  );
});
test('real fake HTTP API provides health and rotating auth fixtures', async () => {
  expect((await fetch(`${api.url}/system/health`)).status).toBe(200);
  const response = await fetch(`${api.url}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'unit-actor',
      password: 'synthetic',
      clientSurface: 'OPS_WEB',
    }),
  });
  const pair = tokenPairSchema.parse(await response.json());
  const rotated = tokenPairSchema.parse(
    await (
      await fetch(`${api.url}/auth/refresh`, {
        method: 'POST',
        body: JSON.stringify({ refreshToken: pair.refreshToken }),
      })
    ).json(),
  );
  expect(rotated.refreshToken).not.toBe(pair.refreshToken);
  expect(
    (
      await fetch(`${api.url}/auth/refresh`, {
        method: 'POST',
        body: JSON.stringify({ refreshToken: pair.refreshToken }),
      })
    ).status,
  ).toBe(401);
});
test('loopback control selects 423/429 and exposes counters without any token', async () => {
  const root = new URL(api.url).origin;
  await fetch(`${root}/__control/locked-unit`, {
    method: 'POST',
    body: JSON.stringify({ status: 429 }),
  });
  const r = await fetch(`${api.url}/guest-auth/login`, {
    method: 'POST',
    body: JSON.stringify({
      phone: 'locked-unit',
      password: 'synthetic',
      clientSurface: 'GUEST_WEB',
    }),
  });
  expect(r.status).toBe(429);
  expect(r.headers.get('retry-after')).toBe('42');
  const text = await (await fetch(`${root}/__control/locked-unit`)).text();
  expect(text).not.toContain('Token');
  expect(JSON.parse(text)).toMatchObject({ status: 429 });
});
test('rejects non-loopback origin control and missing plugin route', async () => {
  const root = new URL(api.url).origin;
  expect(
    (
      await fetch(`${root}/__control/x`, {
        method: 'POST',
        headers: { origin: 'https://evil.test' },
        body: '{}',
      })
    ).status,
  ).toBe(403);
  expect((await fetch(`${api.url}/no-such-route`)).status).toBe(404);
});
