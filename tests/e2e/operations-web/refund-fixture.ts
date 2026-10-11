import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { bookingBalanceSchema, paymentSchema, pinTokenSchema, refundRequestSchema, type UserMe } from '../../../packages/contracts/src/index.js';
import { seedCollection, fixtureOrigin } from './collect-fixture';
export async function loginRefundStaff(page: Page, request: APIRequestContext, role: UserMe['role'], username = `synthetic-refund-${randomUUID()}`) {
  await page.goto('/');
  const token = await page.evaluate(async ({ origin, username }) => {
    const module: typeof import('../../../packages/web-session/src/client.js') = await import(origin + '/__test/session-client.js');
    window.sessionClient = module.createSessionClient({ kind: 'staff' });
    await window.sessionClient.login({ username, password: 'Synthetic-password' });
    return window.sessionClient.getAccessToken();
  }, { origin: fixtureOrigin, username });
  if (!token) throw new Error('No staff fixture session');
  const headers = { authorization: `Bearer ${token}` };
  const result = await request.post(fixtureOrigin + '/__control/f5/actor', { headers, data: { role, propertyIds: ['journey-standard'] } });
  expect(result.status()).toBe(200);
  return { token, headers, username };
}
export async function seedRefund(page: Page, request: APIRequestContext, withFee = true) {
  const { booking } = await seedCollection(page, request);
  const token = await page.evaluate(() => window.sessionClient!.getAccessToken());
  if (!token) throw new Error('Missing maker fixture');
  const headers = { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() };
  const verify = await request.post(fixtureOrigin + '/api/v1/auth/pin/verify', { headers, data: { pin: '123456', bookingId: booking.id } });
  const pinToken = pinTokenSchema.parse(await verify.json()).pinToken;
  const collected = await request.post(fixtureOrigin + '/api/v1/payments', { headers, data: { bookingId: booking.id, type: 'DEPOSIT', method: 'CASH', amount: booking.depositAmount, pinToken } });
  expect(collected.status()).toBe(201);
  const payment = paymentSchema.parse(await collected.json());
  if (withFee) {
    const control = await request.post(`${fixtureOrigin}/__control/f5/bookings/${booking.id}`, { headers, data: { event: 'refund-fee-sample' } });
    expect(control.status()).toBe(200);
  }
  const created = await request.post(fixtureOrigin + '/api/v1/refund-requests', { headers: { ...headers, 'idempotency-key': randomUUID() }, data: { bookingId: booking.id, paymentId: payment.paymentId, reason: 'GUEST_REQUEST', isForceMajeure: false } });
  expect(created.status()).toBe(201);
  const refund = refundRequestSchema.parse(await created.json());
  const balance = await request.get(`${fixtureOrigin}/api/v1/bookings/${booking.id}/balance`, { headers });
  return { booking, payment, refund, balance: bookingBalanceSchema.parse(await balance.json()), makerHeaders: headers };
}
export async function verifyRefundPin(page: Page) {
  await expect(page.getByTestId('pin-dialog')).toBeVisible();
  await page.locator('input[name="pin"]').fill('123456');
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('pin-verified')).toBeVisible();
}

export async function seedApprovedRefund(page: Page, request: APIRequestContext) {
  const value = await seedRefund(page, request);
  const checker = await loginRefundStaff(page, request, 'MANAGER');
  const pin = await request.post(fixtureOrigin + '/api/v1/auth/pin/verify', { headers: checker.headers, data: { pin: '123456', bookingId: value.booking.id } });
  const pinToken = pinTokenSchema.parse(await pin.json()).pinToken;
  const decision = await request.post(`${fixtureOrigin}/api/v1/refund-requests/${value.refund.id}/approve`, { headers: { ...checker.headers, 'idempotency-key': randomUUID() }, data: { approvedAmount: value.refund.requestedAmount, pinToken } });
  expect(decision.status()).toBe(200);
  const cashier = await loginRefundStaff(page, request, 'ACCOUNTANT');
  return { ...value, cashier };
}
export async function prepareRefundPay(page: Page, bookingId: string) {
  await page.goto(`/bookings/${bookingId}/refunds`);
  await page.getByTestId('refund-action-pay').click();
  await verifyRefundPin(page);
  await page.locator('textarea[name="note"]').fill('Synthetic bank receipt; recipient verified');
  await page.getByLabel('Đã xác minh người nhận').check();
}

/** Re-read through the live BFF session: navigation can rotate the fixture's old bearer. */
export async function readRefundLedger(page: Page, bookingId: string, paymentId?: string) {
  return page.evaluate(async ({ origin, bookingId, paymentId }) => {
    const module: typeof import('../fake-api/f5/client-entry') = await import(origin + '/__test/f5-client.js');
    const session = module.createSessionClient({ kind: 'staff' });
    const client = new module.ApiClient({ baseUrl: origin + '/api/v1', getAccessToken: () => session.getAccessToken() });
    try {
      const api = module.createPaymentApi(client);
      const balance = (await api.balance(bookingId)).data;
      const original = paymentId ? (await api.status(paymentId)).data : null;
      return { balance, original };
    } finally { session.dispose(); }
  }, { origin: fixtureOrigin, bookingId, paymentId });
}
