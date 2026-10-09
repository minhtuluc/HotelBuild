import { randomInt } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { quoteInput, bookingInput } from '../../packages/web-session/test/journey-fixtures.js';
const origin = new URL(process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1').origin;
test.beforeEach(({}, info) => {
  test.skip(!info.project.name.startsWith('customer-web'), 'Guest read models belong to customer web');
});
test('booking list and profile work through real BFF HTTP without page.route stubs or SSR errors', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const booking = await page.evaluate(async ({ origin, phone, quoteInput, bookingInput }) => {
    const module: typeof import('../../packages/web-session/src/client.js') = await import(origin + '/__test/session-client.js');
    window.sessionClient = module.createSessionClient({ kind: 'guest' });
    await window.sessionClient.login({ phone, password: 'Synthetic-password' });
    const api = module.createJourneyApiClient({ baseUrl: location.origin, session: window.sessionClient });
    const quote = await api.request({ method: 'POST', path: '/quotes', body: quoteInput,
      decoder: { parse: (value: unknown) => value as { quoteId: string } } });
    return (await api.request({ method: 'POST', path: '/bookings', body: { ...bookingInput, quoteId: quote.data.quoteId },
      decoder: { parse: (value: unknown) => value as { id: string; code: string } } })).data;
  }, { origin, phone: `+84${String(randomInt(1000000000)).padStart(9, '0')}`, quoteInput, bookingInput });
  const listed = page.waitForResponse((response) => response.url().includes('/api/session/journey/bookings?') && response.status() === 200);
  expect((await page.goto('/bookings'))?.status()).toBe(200);
  await listed;
  await expect(page.getByText(booking.code, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('bookings-real-bff.png'), fullPage: true });
  const profile = page.waitForResponse((response) => response.url().endsWith('/api/session/journey/guests/me') && response.status() === 200);
  expect((await page.goto('/profile'))?.status()).toBe(200);
  await profile;
  await expect(page.getByText('Khách mô phỏng', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('profile-real-bff.png'), fullPage: true });
  expect(errors).toEqual([]);
});
