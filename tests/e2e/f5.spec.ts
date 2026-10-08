import { randomInt, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  ApiClient,
  createBookingApi,
  createQuoteApi,
} from '../../packages/api-client/src/index.js';
import { tokenPairSchema } from '../../packages/contracts/src/index.js';
import { quoteInput, bookingInput } from '../../packages/web-session/test/journey-fixtures.js';
declare global {
  interface Window {
    f5Client?: ApiClient;
    f5Pin?: string;
  }
}
const baseUrl = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1';
const origin = new URL(baseUrl).origin;
async function setup(page: Page, kind: 'guest' | 'staff') {
  await page.goto('/');
  await page.evaluate(
    async ({ url, baseUrl, kind }) => {
      const module: typeof import('../../packages/api-client/src/index.js') &
        Pick<typeof import('../../packages/web-session/src/client.js'), 'createSessionClient'> =
        await import(url);
      window.sessionClient = module.createSessionClient({ kind });
      window.f5Client = new module.ApiClient({
        baseUrl,
        getAccessToken: () => window.sessionClient!.getAccessToken(),
        getPinToken: () => window.f5Pin ?? null,
        onUnauthorized: (token) => window.sessionClient!.onUnauthorized(token),
        maxAttempts: 1,
      });
    },
    { url: origin + '/__test/f5-client.js', baseUrl, kind },
  );
}
async function login(page: Page, staff = false) {
  const key = staff
    ? `synthetic-f5-${randomUUID()}`
    : `+84${String(randomInt(1000000000)).padStart(9, '0')}`;
  await page.evaluate(
    async ({ key, staff }) => {
      await window.sessionClient!.login(
        staff
          ? { username: key, password: 'Synthetic-password' }
          : { phone: key, password: 'Synthetic-password' },
      );
      delete window.f5Pin;
    },
    { key, staff },
  );
}
async function control(page: Page, path: string, body: unknown) {
  const status = await page.evaluate(
    async ({ url, body }) => {
      const token = await window.sessionClient!.getAccessToken();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      return response.status;
    },
    { url: origin + '/__control/f5/' + path, body },
  );
  expect(status).toBe(200);
}
async function pin(page: Page, bookingId: string) {
  await page.evaluate(async (bookingId) => {
    const result = await window.f5Client!.request({
      method: 'POST',
      path: '/auth/pin/verify',
      body: { bookingId, pin: '123456' },
      decoder: {
        parse(value: unknown) {
          if (
            typeof value !== 'object' ||
            value === null ||
            !('pinToken' in value) ||
            typeof value.pinToken !== 'string'
          )
            throw new Error('Invalid PIN response');
          return { pinToken: value.pinToken };
        },
      },
    });
    window.f5Pin = result.data.pinToken;
  }, bookingId);
}
test('F5 guest shared client observes timeout/late callback through real Next session', async ({
  page,
  context,
}, info) => {
  test.skip(!info.project.name.startsWith('customer-web'), 'Guest F5 belongs to customer web');
  await setup(page, 'guest');
  await login(page);
  const value = await page.evaluate(
    async ({ url, quoteInput, bookingInput }) => {
      const module: typeof import('../../packages/api-client/src/index.js') = await import(url);
      const quote = (
        await module
          .createQuoteApi(window.f5Client!)
          .quote({ ...quoteInput, propertyId: 'journey-standard' })
      ).data;
      const booking = (
        await module
          .createBookingApi(window.f5Client!)
          .create({ ...bookingInput, propertyId: 'journey-standard', quoteId: quote.quoteId })
      ).data;
      const payment = (
        await module.createPaymentApi(window.f5Client!).createOnline({
          bookingId: booking.id,
          type: 'DEPOSIT',
          method: 'MOMO',
          amount: 300000,
          returnUrl: location.origin + '/return?result=success',
        })
      ).data;
      return { booking, payment };
    },
    { url: origin + '/__test/f5-client.js', quoteInput, bookingInput },
  );
  expect(value.payment.status).toBe('PENDING');
  const replayed = await page.evaluate(
    async ({ bookingId }) => {
      const request = {
        method: 'POST' as const,
        path: '/payments/online',
        body: {
          bookingId,
          type: 'DEPOSIT',
          method: 'MOMO',
          amount: 300000,
          returnUrl: location.origin + '/return',
        },
        idempotencyKey: crypto.randomUUID(),
        decoder: {
          parse(value: unknown) {
            return value;
          },
        },
      };
      const first = await window.f5Client!.request(request);
      const retry = await window.f5Client!.request(request);
      return [first.replayed, retry.replayed];
    },
    { bookingId: value.booking.id },
  );
  expect(replayed).toEqual([false, true]);
  await control(page, `bookings/${value.booking.id}`, { event: 'hold-boundary' });
  await control(page, `bookings/${value.booking.id}`, {
    event: 'payment-timeout',
    paymentId: value.payment.paymentId,
  });
  await control(page, `bookings/${value.booking.id}`, {
    event: 'payment-success',
    paymentId: value.payment.paymentId,
  });
  const result = await page.evaluate(
    async ({ url, bookingId, paymentId }) => {
      const module: typeof import('../../packages/api-client/src/index.js') = await import(url);
      return {
        booking: (await module.createBookingApi(window.f5Client!).get(bookingId)).data,
        payment: (await module.createPaymentApi(window.f5Client!).status(paymentId)).data,
        refunds: (await module.createRefundApi(window.f5Client!).list({ bookingId })).data.data,
      };
    },
    {
      url: origin + '/__test/f5-client.js',
      bookingId: value.booking.id,
      paymentId: value.payment.paymentId,
    },
  );
  expect(result.booking).toMatchObject({ status: 'EXPIRED', paidAmount: 300000, balanceDue: 0 });
  expect(result.payment.status).toBe('SUCCEEDED');
  expect(result.refunds).toHaveLength(1);
  expect(result.refunds[0]).toMatchObject({ requestedAmount: 300000, refundFee: 0 });
  expect(
    (await context.cookies()).find((cookie) => cookie.name === 'pinehill_guest_refresh'),
  ).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  expect(await page.evaluate(() => JSON.stringify(Object.values(localStorage)))).not.toContain(
    'synthetic-access',
  );
  await info.attach('f5-guest-http.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: info.outputPath('f5-guest-real-browser.png') });
  await page.evaluate(() => window.sessionClient!.dispose());
});
test('F5 staff shared client uses distinct maker, manager and accountant sessions', async ({
  page,
  context,
}, info) => {
  test.skip(!info.project.name.startsWith('operations-web'), 'Staff F5 belongs to operations web');
  // Seed through the same live F4 HTTP API; the browser uses a real staff Next session afterwards.
  const pair = tokenPairSchema.parse(
    await (
      await fetch(baseUrl + '/guest-auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone: `synthetic-seed-${randomUUID()}`,
          password: 'Synthetic-password',
        }),
      })
    ).json(),
  );
  const seed = new ApiClient({ baseUrl, getAccessToken: () => pair.accessToken });
  const quote = (
    await createQuoteApi(seed).quote({ ...quoteInput, propertyId: 'journey-standard' })
  ).data;
  const booking = (
    await createBookingApi(seed).create({
      ...bookingInput,
      propertyId: 'journey-standard',
      quoteId: quote.quoteId,
    })
  ).data;
  await setup(page, 'staff');
  await login(page, true);
  await control(page, 'actor', { role: 'FRONT_DESK', propertyIds: ['journey-standard'] });
  await pin(page, booking.id);
  const refund = await page.evaluate(
    async ({ url, bookingId }) => {
      const module: typeof import('../../packages/api-client/src/index.js') = await import(url);
      const payment = (
        await module
          .createPaymentApi(window.f5Client!)
          .create({ bookingId, type: 'DEPOSIT', method: 'CASH', amount: 300000 })
      ).data;
      return (
        await module.createRefundApi(window.f5Client!).create({
          bookingId,
          paymentId: payment.paymentId,
          reason: 'GUEST_REQUEST',
          isForceMajeure: false,
        })
      ).data;
    },
    { url: origin + '/__test/f5-client.js', bookingId: booking.id },
  );
  expect(refund.status).toBe('PENDING');
  expect(refund.requestedAmount).toBe(150000);
  await login(page, true);
  await control(page, 'actor', { role: 'MANAGER', propertyIds: ['journey-standard'] });
  await pin(page, booking.id);
  const decision = await page.evaluate(
    async ({ url, id }) => {
      const module: typeof import('../../packages/api-client/src/index.js') = await import(url);
      return (
        await module.createRefundApi(window.f5Client!).approve(id, { approvedAmount: 150000 })
      ).data;
    },
    { url: origin + '/__test/f5-client.js', id: refund.id },
  );
  expect(decision.status).toBe('APPROVED');
  expect(decision.approvedBy).not.toBe(refund.requestedBy);
  await login(page, true);
  await control(page, 'actor', { role: 'ACCOUNTANT', propertyIds: ['journey-standard'] });
  await pin(page, booking.id);
  const result = await page.evaluate(
    async ({ url, id, bookingId }) => {
      const module: typeof import('../../packages/api-client/src/index.js') = await import(url);
      const paid = (
        await module
          .createRefundApi(window.f5Client!)
          .pay(id, { method: 'BANK_TRANSFER', bankNote: 'Synthetic verified recipient' })
      ).data;
      return {
        paid,
        balance: (await module.createPaymentApi(window.f5Client!).balance(bookingId)).data,
      };
    },
    { url: origin + '/__test/f5-client.js', id: refund.id, bookingId: booking.id },
  );
  expect(result.paid.status).toBe('PAID');
  expect(result.balance).toMatchObject({
    paidAmount: 300000,
    refundedAmount: 150000,
    reservedRefundAmount: 0,
  });
  expect(
    (await context.cookies()).find((cookie) => cookie.name === 'pinehill_staff_refresh'),
  ).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  await info.attach('f5-staff-http.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('f5-staff-real-browser.png') });
  await page.evaluate(() => window.sessionClient!.dispose());
});
