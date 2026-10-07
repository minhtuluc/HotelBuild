import { randomInt, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { createSessionClient } from '../../packages/web-session/src/client.js';
declare global {
  interface Window {
    sessionClient?: ReturnType<typeof createSessionClient>;
    sessionExpired?: number;
  }
}
const root = new URL(process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1').origin;
test('BFF cookie and real two-tab single refresh, stale401 and logout', async ({
  page,
  context,
  request,
}, info) => {
  const kind = info.project.name.startsWith('operations-web') ? 'staff' : 'guest';
  const key =
    kind === 'staff'
      ? `synthetic-${randomUUID()}`
      : `+84${String(randomInt(1000000000)).padStart(9, '0')}`;
  const credentials =
    kind === 'staff'
      ? { username: key, password: 'synthetic-password' }
      : { phone: key, password: 'synthetic-password' };
  await page.goto('/');
  await page.evaluate(
    async ({ url, kind, credentials }) => {
      const module: typeof import('../../packages/web-session/src/client.js') = await import(url);
      if (kind !== 'staff' && kind !== 'guest') throw new Error('Invalid test surface');
      window.sessionClient = module.createSessionClient({ kind });
      window.sessionExpired = 0;
      window.addEventListener('session-expired', () => {
        window.sessionExpired = (window.sessionExpired ?? 0) + 1;
      });
      await window.sessionClient.login(credentials);
    },
    { url: `${root}/__test/session-client.js`, kind, credentials },
  );
  const cookies = await context.cookies();
  const refreshCookie = cookies.find((value) => value.name === `pinehill_${kind}_refresh`);
  expect(refreshCookie).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/api/session',
  });
  const old = await page.evaluate(() => window.sessionClient?.getAccessToken());
  expect(old).toBeTruthy();
  if (typeof old !== 'string') throw new Error('Missing synthetic access token');
  expect(await page.evaluate(() => document.cookie)).not.toContain('refresh');
  const peer = await context.newPage();
  await peer.goto('/');
  await peer.evaluate(
    async ({ url, kind }) => {
      const module: typeof import('../../packages/web-session/src/client.js') = await import(url);
      if (kind !== 'staff' && kind !== 'guest') throw new Error('Invalid test surface');
      window.sessionClient = module.createSessionClient({ kind });
      window.sessionExpired = 0;
      window.addEventListener('session-expired', () => {
        window.sessionExpired = (window.sessionExpired ?? 0) + 1;
      });
    },
    { url: `${root}/__test/session-client.js`, kind },
  );
  await request.post(`${root}/__control/${encodeURIComponent(key)}`, { data: { delayMs: 200 } });
  const results = await Promise.all([
    page.evaluate((token) => window.sessionClient?.onUnauthorized(token), old),
    peer.evaluate((token) => window.sessionClient?.onUnauthorized(token), old),
  ]);
  expect(results).toEqual([true, true]);
  expect(
    await (await request.get(`${root}/__control/${encodeURIComponent(key)}`)).json(),
  ).toMatchObject({ refreshCount: 1 });
  const tokens = await Promise.all([
    page.evaluate(() => window.sessionClient?.getAccessToken()),
    peer.evaluate(() => window.sessionClient?.getAccessToken()),
  ]);
  expect(tokens[0]).toBe(tokens[1]);
  expect(tokens[0]).not.toBe(old);
  expect(await peer.evaluate((token) => window.sessionClient?.onUnauthorized(token), old)).toBe(
    true,
  );
  expect(
    await (await request.get(`${root}/__control/${encodeURIComponent(key)}`)).json(),
  ).toMatchObject({ refreshCount: 1 });
  const storage = await page.evaluate(() => JSON.stringify(Object.values(localStorage)));
  expect(storage).not.toContain(tokens[0] ?? 'missing');
  expect(storage).not.toContain('refresh');
  await page.evaluate(() => window.sessionClient?.logout());
  await expect.poll(() => peer.evaluate(() => window.sessionExpired)).toBe(1);
  expect(await peer.evaluate(() => window.sessionClient?.getAccessToken())).toBeNull();
  expect((await context.cookies()).some((value) => value.name === `pinehill_${kind}_refresh`)).toBe(
    false,
  );
  await page.screenshot({ path: info.outputPath('session-browser.png') });
  await page.evaluate(() => window.sessionClient?.dispose());
  await peer.evaluate(() => window.sessionClient?.dispose());
});
test('real Next BFF rejects CSRF and clears refresh cookie after upstream401', async ({
  page,
  context,
  request,
}, info) => {
  const kind = info.project.name.startsWith('operations-web') ? 'staff' : 'guest';
  const key =
    kind === 'staff'
      ? `synthetic-${randomUUID()}`
      : `+84${String(randomInt(1000000000)).padStart(9, '0')}`;
  await page.goto('/');
  const credentials =
    kind === 'staff'
      ? { username: key, password: 'synthetic-password' }
      : { phone: key, password: 'synthetic-password' };
  const login = await page.evaluate(async (body) => {
    const response = await fetch('/api/session/login', {
      method: 'POST',
      headers: { 'x-session-request': '1', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.text() };
  }, credentials);
  expect(login.status).toBe(200);
  expect(login.body).not.toContain('refresh');
  expect(
    await page.evaluate(async () => {
      const response = await fetch('/api/session/refresh', { method: 'POST' });
      return response.status;
    }),
  ).toBe(403);
  expect((await context.cookies()).some((value) => value.name === `pinehill_${kind}_refresh`)).toBe(
    true,
  );
  await request.post(`${root}/__control/${encodeURIComponent(key)}`, { data: { status: 401 } });
  const refresh = await page.evaluate(async () => {
    const response = await fetch('/api/session/refresh', {
      method: 'POST',
      headers: { 'x-session-request': '1' },
    });
    return { status: response.status, text: await response.text() };
  });
  expect(refresh.status).toBe(401);
  expect(refresh.text).not.toContain('synthetic-refresh');
  expect((await context.cookies()).some((value) => value.name === `pinehill_${kind}_refresh`)).toBe(
    false,
  );
});
