import { randomInt } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import type { createJourneyApiClient } from '../../packages/web-session/src/client.js';
import {
  availabilitySchema,
  listResponseSchema,
  ratePlanPublicSchema,
  quoteSchema,
  holdSchema,
  bookingSummarySchema,
} from '../../packages/contracts/src/index.js';
import {
  quoteInput,
  bookingInput,
  search,
} from '../../packages/web-session/test/journey-fixtures.js';
declare global {
  interface Window {
    journeyClient?: ReturnType<typeof createJourneyApiClient>;
  }
}
const fixtureOrigin = new URL(process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1')
  .origin;
async function setup(page: Page) {
  await page.goto('/');
  await page.evaluate(async (url) => {
    const module: typeof import('../../packages/web-session/src/client.js') = await import(url);
    window.sessionClient = module.createSessionClient({ kind: 'guest' });
    window.journeyClient = module.createJourneyApiClient({
      baseUrl: location.origin,
      session: window.sessionClient,
    });
  }, fixtureOrigin + '/__test/session-client.js');
}
async function login(page: Page) {
  const phone = `+84${String(randomInt(1000000000)).padStart(9, '0')}`;
  await page.evaluate(
    (phone) => window.sessionClient?.login({ phone, password: 'Synthetic-password' }),
    phone,
  );
}
async function call(page: Page, path: string, body?: unknown, method: 'GET' | 'POST' = 'POST') {
  return page.evaluate(
    async ({ path, body, method }) => {
      if (!window.journeyClient) throw new Error('Missing journey client');
      try {
        const response = await window.journeyClient.request({
          method,
          path,
          body,
          decoder: {
            parse(value: unknown) {
              return value;
            },
          },
        });
        return { status: response.status, body: response.data, replayed: response.replayed };
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          typeof error.status === 'number' &&
          'code' in error
        )
          return { status: error.status, body: { code: error.code }, replayed: false };
        throw error;
      }
    },
    { path, body, method },
  );
}
test.beforeEach(({}, info) => {
  test.skip(!info.project.name.startsWith('customer-web'), 'Journey belongs to the customer app');
});
test('anonymous search and quote, then login, hold and booking use real Next BFF HTTP', async ({
  page,
  context,
}, info) => {
  await setup(page);
  const available = await call(
    page,
    '/inventory/availability?' +
      new URLSearchParams({
        ...search,
        propertyId: 'journey-standard',
        adults: '2',
        children: '0',
        roomCount: '1',
      }),
    undefined,
    'GET',
  );
  expect(available.status).toBe(200);
  expect(availabilitySchema.parse(available.body).data[0]?.totalFrom).toBe(1000000);
  const plans = await call(page, '/rate-plans?propertyId=journey-standard', undefined, 'GET');
  expect(plans.status).toBe(200);
  expect(listResponseSchema(ratePlanPublicSchema).parse(plans.body).data).toHaveLength(4);
  const publicQuote = await call(page, '/quotes', {
    ...quoteInput,
    propertyId: 'journey-standard',
  });
  expect(publicQuote.status).toBe(201);
  const anonymous = quoteSchema.parse(publicQuote.body);
  expect(
    (
      await call(page, '/holds', {
        ...search,
        propertyId: 'journey-standard',
        quoteId: anonymous.quoteId,
      })
    ).status,
  ).toBe(401);
  await login(page);
  const refreshed = await call(page, '/quotes', { ...quoteInput, propertyId: 'journey-standard' });
  expect(refreshed.status).toBe(201);
  const quote = quoteSchema.parse(refreshed.body);
  const held = await call(page, '/holds', {
    ...search,
    propertyId: 'journey-standard',
    quoteId: quote.quoteId,
  });
  expect(held.status).toBe(201);
  expect(holdSchema.parse(held.body).quotedTotal).toBe(quote.total);
  const created = await call(page, '/bookings', {
    ...bookingInput,
    propertyId: 'journey-standard',
    quoteId: quote.quoteId,
  });
  expect(created.status).toBe(201);
  const booking = bookingSummarySchema.parse(created.body);
  expect(booking.totalAmount).toBe(quote.total);
  expect(booking.depositAmount).toBe(quote.depositAmount);
  const loaded = await call(page, `/bookings/${booking.id}`, undefined, 'GET');
  expect(loaded.status).toBe(200);
  expect(bookingSummarySchema.parse(loaded.body)).toEqual(booking);
  expect(
    (await context.cookies()).find((cookie) => cookie.name === 'pinehill_guest_refresh'),
  ).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('refresh');
  expect(await page.evaluate(() => JSON.stringify(Object.values(localStorage)))).not.toContain(
    'synthetic-access',
  );
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: info.outputPath('journey-real-browser.png') });
  await page.evaluate(() => window.sessionClient?.dispose());
});
for (const scenario of ['journey-expired', 'journey-taken']) {
  test(`${scenario} keeps upstream rejection visible in the real browser client`, async ({
    page,
  }) => {
    await setup(page);
    await login(page);
    const quoted = await call(page, '/quotes', { ...quoteInput, propertyId: scenario });
    expect(quoted.status).toBe(201);
    const quote = quoteSchema.parse(quoted.body);
    const held = await call(page, '/holds', {
      ...search,
      propertyId: scenario,
      quoteId: quote.quoteId,
    });
    expect(held.status).toBe(scenario === 'journey-expired' ? 410 : 409);
    expect(held.body).toEqual({
      code: scenario === 'journey-expired' ? 'E_RATE_QUOTE_EXPIRED' : 'E_INV_ROOM_TAKEN',
    });
    await page.evaluate(() => window.sessionClient?.dispose());
  });
}
test('duplicate warning survives HTTP and a revoked guest token cannot keep booking', async ({
  page,
}) => {
  await setup(page);
  await login(page);
  const quoted = await call(page, '/quotes', { ...quoteInput, propertyId: 'journey-duplicate' });
  expect(quoted.status).toBe(201);
  const quote = quoteSchema.parse(quoted.body);
  const created = await call(page, '/bookings', {
    ...bookingInput,
    propertyId: 'journey-duplicate',
    quoteId: quote.quoteId,
  });
  expect(created.status).toBe(201);
  const booking = bookingSummarySchema.parse(created.body);
  expect(booking.duplicateSuspected).toBe(true);
  const rejected = await page.evaluate(async (id) => {
    const token = await window.sessionClient?.getAccessToken();
    if (typeof token !== 'string') throw new Error('Missing authenticated synthetic access');
    const before = await fetch(`/api/session/journey/bookings/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (before.status !== 200) throw new Error('Authenticated bearer did not work before logout');
    await window.sessionClient?.logout();
    const response = await fetch(`/api/session/journey/bookings/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return response.status;
  }, booking.id);
  expect(rejected).toBe(401);
  await page.evaluate(() => window.sessionClient?.dispose());
});
