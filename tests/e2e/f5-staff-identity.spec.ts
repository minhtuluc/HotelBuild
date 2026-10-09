import { test, expect } from '@playwright/test';
const origin = new URL(process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1').origin;
test.beforeEach(({}, info) => {
  test.skip(!info.project.name.startsWith('operations-web'), 'Staff identity belongs to operations web');
});
test('PIN/maker-checker screens can obtain staff identity via real BFF session and fake HTTP', async ({ page }) => {
  await page.goto('/');
  const username = `synthetic-maker-${crypto.randomUUID()}`;
  const me = await page.evaluate(async ({ origin, username }) => {
    const module: typeof import('../../packages/web-session/src/client.js') = await import(origin + '/__test/session-client.js');
    window.sessionClient = module.createSessionClient({ kind: 'staff' });
    await window.sessionClient.login({ username, password: 'Synthetic-password' });
    const token = await window.sessionClient.getAccessToken();
    const response = await fetch(origin + '/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Staff identity failed ${response.status}`);
    const body: unknown = await response.json();
    return body;
  }, { origin, username });
  expect(me).toMatchObject({ userId: username, role: 'FRONT_DESK', propertyScope: ['journey-standard'], hasPin: true });
});
