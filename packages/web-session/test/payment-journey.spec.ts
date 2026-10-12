import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createJourneyHandler } from '../src/server.js';
let server: Server,
  baseUrl = '';
let payload: unknown;
const calls: { path: string; key: unknown; body: unknown }[] = [];
const payment = {
  paymentId: 'p1',
  bookingId: 'b1',
  type: 'DEPOSIT',
  method: 'MOMO',
  amount: 49501,
  status: 'PENDING',
  providerTxnId: null,
  paymentUrl: 'https://provider.test/pay',
  expiresAt: null,
  paidAt: null,
  createdAt: '2026-10-12T02:00:00Z',
};
const input = {
  bookingId: 'b1',
  type: 'DEPOSIT',
  method: 'MOMO',
  amount: 49501,
  returnUrl: 'https://guest.test/booking/b1/pay',
};
const key = '7ed2bdb1-c3e0-467f-89e0-058f08173141';
beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      let text = '';
      for await (const c of req) text += String(c);
      calls.push({
        path: req.url!,
        key: req.headers['idempotency-key'],
        body: text ? JSON.parse(text) : undefined,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    })();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('port');
  baseUrl = `http://127.0.0.1:${a.port}/api/v1`;
});
afterAll(() => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))));
beforeEach(() => {
  payload = payment;
  calls.length = 0;
});
function req(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://guest.test/api/session/journey${path}`, {
    method,
    headers: {
      origin: 'https://guest.test',
      'x-session-request': '1',
      authorization: 'Bearer synthetic',
      'idempotency-key': key,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test('online POST crosses real upstream once with stable exact key and body', async () => {
  const r = await createJourneyHandler({ baseUrl })(req('/payments/online', 'POST', input));
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject(payment);
  expect(calls).toEqual([{ path: '/api/v1/payments/online', key, body: input }]);
});
test('payment status and balance are decoded protected GET routes', async () => {
  expect((await createJourneyHandler({ baseUrl })(req('/payments/p1/status'))).status).toBe(200);
  payload = {
    bookingId: 'b1',
    currency: 'VND',
    totalAmount: 1000000,
    paidAmount: 250499,
    refundedAmount: 0,
    reservedRefundAmount: 0,
    balanceDue: 749501,
    onlineDepositAmount: 49501,
  };
  const r = await createJourneyHandler({ baseUrl })(req('/bookings/b1/balance'));
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ onlineDepositAmount: 49501 });
});
test.each(['/payments/p1/status', '/bookings/b1/balance'])(
  'missing bearer blocks %s before upstream',
  async (path) => {
    expect(
      (await createJourneyHandler({ baseUrl })(req(path, 'GET', undefined, { authorization: '' })))
        .status,
    ).toBe(401);
    expect(calls).toHaveLength(0);
  },
);
test.each([
  { origin: 'https://evil.test' },
  { 'x-session-request': '0' },
  { 'idempotency-key': 'bad' },
])('invalid write headers rejected', async (headers) => {
  expect(
    (await createJourneyHandler({ baseUrl })(req('/payments/online', 'POST', input, headers)))
      .status,
  ).toBeGreaterThanOrEqual(400);
  expect(calls).toHaveLength(0);
});
test.each([
  { ...input, type: 'BALANCE' },
  { ...input, method: 'CASH' },
  { ...input, amount: 0 },
  { ...input, cardNumber: '4111111111111111' },
])('SCR06 only permits exact DEPOSIT online body', async (body) => {
  expect(
    (await createJourneyHandler({ baseUrl })(req('/payments/online', 'POST', body))).status,
  ).toBe(400);
  expect(calls).toHaveLength(0);
});
test('bad upstream data is never rendered as successful', async () => {
  payload = { ...payment, amount: NaN };
  expect((await createJourneyHandler({ baseUrl })(req('/payments/p1/status'))).status).toBe(502);
});

test.each(['https://evil.test/return', 'https://guest.test/booking/foreign/pay'])(
  'payment return URL is bound to same-origin booking: %s',
  async (returnUrl) => {
    const r = await createJourneyHandler({ baseUrl })(
      req('/payments/online', 'POST', { ...input, returnUrl }),
    );
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  },
);
