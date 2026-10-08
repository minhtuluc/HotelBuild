import { expect, test } from 'vitest';
import { paymentSchema, tokenPairSchema } from '@pinehill/contracts';
import { setup, online } from './f5-fixtures.js';
const f = setup();
test('confirmed late surplus is reserved for SYSTEM refund on its own source payment', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const deposit = (await owner.payments.createOnline(online(booking.id))).data;
  await f.control(owner, booking.id, 'payment-success', deposit.paymentId);
  const input = { ...online(booking.id, 700000), type: 'BALANCE' as const };
  const first = (await owner.payments.createOnline(input)).data;
  const late = (await owner.payments.createOnline(input)).data;
  await f.control(owner, booking.id, 'payment-success', first.paymentId);
  await f.control(owner, booking.id, 'payment-timeout', late.paymentId);
  await f.control(owner, booking.id, 'payment-success', late.paymentId);
  await f.control(owner, booking.id, 'payment-success', late.paymentId);
  expect((await owner.bookings.get(booking.id)).data).toMatchObject({
    status: 'CONFIRMED',
    paidAmount: 1700000,
    balanceDue: 0,
  });
  expect((await owner.payments.balance(booking.id)).data.reservedRefundAmount).toBe(700000);
  const refunds = (await owner.refunds.list({ bookingId: booking.id })).data.data;
  expect(refunds).toHaveLength(1);
  expect(refunds[0]).toMatchObject({
    paymentId: late.paymentId,
    reason: 'SYSTEM',
    refundPercent: 100,
    requestedAmount: 700000,
    refundFee: 0,
  });
});
test('local payment timeout cannot expire a hold that is still valid', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const payment = (await owner.payments.createOnline(online(booking.id))).data;
  await f.control(owner, booking.id, 'payment-timeout', payment.paymentId);
  expect((await owner.bookings.get(booking.id)).data.status).toBe('HELD');
  expect((await owner.payments.status(payment.paymentId)).data.status).toBe('FAILED');
  await f.control(owner, booking.id, 'payment-success', payment.paymentId);
  expect((await owner.bookings.get(booking.id)).data).toMatchObject({
    status: 'CONFIRMED',
    paidAmount: 300000,
  });
  expect((await owner.refunds.list({ bookingId: booking.id })).data.data).toEqual([]);
});
test('success at the exact hold boundary expires instead of reclaiming a room', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const payment = (await owner.payments.createOnline(online(booking.id))).data;
  await f.control(owner, booking.id, 'hold-boundary');
  await f.control(owner, booking.id, 'payment-success', payment.paymentId);
  expect((await owner.bookings.get(booking.id)).data).toMatchObject({
    status: 'EXPIRED',
    paidAmount: 300000,
    balanceDue: 0,
  });
  expect((await owner.refunds.list({ bookingId: booking.id })).data.data[0]).toMatchObject({
    requestedAmount: 300000,
    refundPercent: 100,
    refundFee: 0,
  });
});
test('unsolicited provider callbacks cannot settle the simulator payment', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const payment = (await owner.payments.createOnline(online(booking.id))).data;
  expect(
    (
      await f.raw(
        '/integrations/psp/vnpay/callback?vnp_TxnRef=' + payment.paymentId + '&vnp_ResponseCode=00',
        undefined,
        undefined,
        'GET',
      )
    ).status,
  ).toBe(404);
  expect(
    (await f.raw('/integrations/psp/momo/callback', { resultCode: 0, orderId: payment.paymentId }))
      .status,
  ).toBe(404);
  expect((await owner.payments.status(payment.paymentId)).data.status).toBe('PENDING');
});
test('online creation stays PENDING until simulator callback, even after visiting payment URL', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const created = await owner.payments.createOnline(online(booking.id));
  expect(created.status).toBe(201);
  expect(created.data.status).toBe('PENDING');
  expect(created.data.paymentUrl).toContain(f.origin() + '/__test/f5/');
  expect((await fetch(created.data.paymentUrl! + '?result=success')).status).toBe(200);
  expect((await owner.payments.status(created.data.paymentId)).data.status).toBe('PENDING');
  expect((await owner.payments.balance(booking.id)).data.paidAmount).toBe(0);
  await f.control(owner, booking.id, 'payment-success', created.data.paymentId);
  await f.control(owner, booking.id, 'payment-success', created.data.paymentId);
  await f.control(owner, booking.id, 'payment-failed', created.data.paymentId);
  expect((await owner.payments.status(created.data.paymentId)).data.status).toBe('SUCCEEDED');
  expect((await owner.bookings.get(booking.id)).data).toMatchObject({
    status: 'CONFIRMED',
    paidAmount: 300000,
    balanceDue: 700000,
  });
});
test.each(['expire', 'cancel', 'no-show'])(
  'late success after %s credits once and cannot revive booking',
  async (terminal) => {
    const owner = await f.actor();
    const booking = await f.booking(owner);
    const payment = (await owner.payments.createOnline(online(booking.id))).data;
    await f.control(owner, booking.id, 'payment-timeout', payment.paymentId);
    expect((await owner.payments.status(payment.paymentId)).data.status).toBe('FAILED');
    await f.control(owner, booking.id, terminal);
    await f.control(owner, booking.id, 'payment-success', payment.paymentId);
    await f.control(owner, booking.id, 'payment-success', payment.paymentId);
    expect((await owner.bookings.get(booking.id)).data).toMatchObject({
      status: terminal === 'expire' ? 'EXPIRED' : terminal === 'cancel' ? 'CANCELLED' : 'NO_SHOW',
      paidAmount: 300000,
    });
    const refunds = (await owner.refunds.list({ bookingId: booking.id })).data.data;
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      paymentId: payment.paymentId,
      requestedAmount: 300000,
      refundPercent: 100,
      refundFee: 0,
      status: 'PENDING',
    });
    expect((await owner.payments.balance(booking.id)).data.reservedRefundAmount).toBe(300000);
  },
);
test('timeout and late success keep an already confirmed booking confirmed', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const first = (await owner.payments.createOnline(online(booking.id))).data;
  await f.control(owner, booking.id, 'payment-success', first.paymentId);
  const second = (
    await owner.payments.createOnline({ ...online(booking.id, 700000), type: 'BALANCE' })
  ).data;
  await f.control(owner, booking.id, 'payment-timeout', second.paymentId);
  expect((await owner.bookings.get(booking.id)).data.status).toBe('CONFIRMED');
  await f.control(owner, booking.id, 'payment-success', second.paymentId);
  expect((await owner.payments.balance(booking.id)).data).toMatchObject({
    paidAmount: 1000000,
    balanceDue: 0,
  });
  expect((await owner.refunds.list({ bookingId: booking.id })).data.data).toEqual([]);
});
test.each([
  ['gateway-error', 502, 'E_PAY_GATEWAY_ERROR'],
  ['gateway-timeout', 504, 'E_PAY_GATEWAY_TIMEOUT'],
])('control %s provides the published retryable error', async (event, status, code) => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  await f.control(owner, booking.id, String(event));
  await expect(owner.payments.createOnline(online(booking.id))).rejects.toMatchObject({
    status,
    code,
  });
  await f.control(owner, booking.id, 'clear-error');
  expect((await owner.payments.createOnline(online(booking.id))).data.status).toBe('PENDING');
});
test('strict amount, method and DTO validation cannot write a payment', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  await expect(owner.payments.createOnline(online(booking.id, 300001))).rejects.toMatchObject({
    status: 422,
    code: 'E_PAY_AMOUNT_MISMATCH',
  });
  for (const changed of [
    { ...online(booking.id), method: 'CASH' },
    { ...online(booking.id), cardNumber: 'synthetic-card' },
  ]) {
    expect((await f.raw('/payments/online', changed, owner.accessToken)).status).toBe(400);
  }
  expect((await owner.payments.balance(booking.id)).data.paidAmount).toBe(0);
});
test('canonical replay returns original snapshot while changed body/key and revoked access fail', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const key = crypto.randomUUID();
  const body = online(booking.id);
  const first = await f.raw('/payments/online', body, owner.accessToken, 'POST', key);
  expect(first.status).toBe(201);
  const payment = paymentSchema.parse(await first.json());
  await f.control(owner, booking.id, 'payment-success', payment.paymentId);
  const replay = await f.raw(
    '/payments/online',
    {
      returnUrl: body.returnUrl,
      amount: body.amount,
      method: body.method,
      type: body.type,
      bookingId: body.bookingId,
    },
    owner.accessToken,
    'POST',
    key,
  );
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect(await replay.json()).toEqual(payment);
  expect(
    (
      await f.raw(
        '/payments/online',
        { ...body, returnUrl: 'http://127.0.0.1/changed' },
        owner.accessToken,
        'POST',
        key,
      )
    ).status,
  ).toBe(409);
  expect((await f.raw('/payments/online', body, owner.accessToken, 'POST', 'invalid')).status).toBe(
    400,
  );
  await f.raw('/auth/logout', undefined, owner.accessToken, 'POST');
  expect((await f.raw('/payments/online', body, owner.accessToken, 'POST', key)).status).toBe(401);
});
test('missing, invented, rotated and foreign guest access cannot read or control another payment', async () => {
  const owner = await f.actor();
  const other = await f.actor('synthetic-other');
  const booking = await f.booking(owner);
  const payment = (await owner.payments.createOnline(online(booking.id))).data;
  for (const token of [undefined, 'invented'])
    expect((await f.raw(`/payments/${payment.paymentId}/status`, undefined, token)).status).toBe(
      401,
    );
  for (const path of [`/payments/${payment.paymentId}/status`, `/bookings/${booking.id}/balance`])
    expect((await f.raw(path, undefined, other.accessToken)).status).toBe(404);
  expect(
    (
      await f.raw(
        `/__control/f5/bookings/${booking.id}`,
        { event: 'payment-success', paymentId: payment.paymentId },
        other.accessToken,
      )
    ).status,
  ).toBe(404);
  const rotated = tokenPairSchema.parse(
    await (await f.raw('/guest-auth/refresh', { refreshToken: owner.refreshToken })).json(),
  );
  expect(
    (await f.raw(`/payments/${payment.paymentId}/status`, undefined, owner.accessToken)).status,
  ).toBe(401);
  expect(
    (await f.raw(`/payments/${payment.paymentId}/status`, undefined, rotated.accessToken)).status,
  ).toBe(200);
});
