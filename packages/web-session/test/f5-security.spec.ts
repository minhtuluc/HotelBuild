import { expect, test } from 'vitest';
import { setup, online } from './f5-fixtures.js';
const f = setup();
const second = setup();
test.each(['HOUSEKEEPING', 'SYSADMIN'])(
  '%s cannot read payment or balance even in the same property',
  async (role) => {
    const owner = await f.actor();
    const booking = await f.booking(owner);
    const payment = (await owner.payments.createOnline(online(booking.id))).data;
    const staff = await f.actor('synthetic-denied', role);
    for (const path of [
      `/payments/${payment.paymentId}/status`,
      `/bookings/${booking.id}/balance`,
      `/auth/pin/verify`,
    ]) {
      const result = await f.raw(
        path,
        path.endsWith('verify') ? { pin: '123456', bookingId: booking.id } : undefined,
        staff.accessToken,
      );
      expect(result.status).toBe(403);
    }
  },
);
test('server-local payments, refunds, bearer and PIN do not leak into another fixture server', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const payment = (await owner.payments.createOnline(online(booking.id))).data;
  const peer = await second.actor();
  expect(
    (await second.raw(`/payments/${payment.paymentId}/status`, undefined, owner.accessToken))
      .status,
  ).toBe(401);
  expect(
    (await second.raw(`/payments/${payment.paymentId}/status`, undefined, peer.accessToken)).status,
  ).toBe(404);
  expect((await peer.refunds.list()).data.data).toEqual([]);
  const firstClerk = await f.actor('synthetic-clerk', 'FRONT_DESK');
  const foreignPin = await firstClerk.verify(booking.id);
  const secondClerk = await second.actor('synthetic-clerk', 'FRONT_DESK');
  const peerBooking = await second.booking(peer);
  const rejected = await second.raw(
    '/payments',
    {
      bookingId: peerBooking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: 300000,
      pinToken: foreignPin,
    },
    secondClerk.accessToken,
  );
  expect(rejected.status).toBe(401);
});
test('PIN and successful replay remain protected by current role and property scope', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const another = await f.booking(owner);
  const clerk = await f.actor('synthetic-clerk', 'FRONT_DESK');
  const pin = await clerk.verify(booking.id);
  const key = crypto.randomUUID();
  const body = {
    bookingId: booking.id,
    type: 'DEPOSIT',
    method: 'CASH',
    amount: 300000,
    pinToken: pin,
  };
  expect(
    (await f.raw('/payments', { ...body, bookingId: another.id }, clerk.accessToken)).status,
  ).toBe(401);
  expect((await f.raw('/payments', body, clerk.accessToken, 'POST', key)).status).toBe(201);
  expect(
    (await f.raw('/payments', body, clerk.accessToken, 'POST', key)).headers.get(
      'idempotency-replayed',
    ),
  ).toBe('true');
  await f.raw(
    '/__control/f5/actor',
    { role: 'HOUSEKEEPING', propertyIds: ['journey-standard'] },
    clerk.accessToken,
  );
  expect((await f.raw('/payments', body, clerk.accessToken, 'POST', key)).status).toBe(403);
  await f.raw(
    '/__control/f5/actor',
    { role: 'FRONT_DESK', propertyIds: ['unrelated'] },
    clerk.accessToken,
  );
  expect((await f.raw('/payments', body, clerk.accessToken, 'POST', key)).status).toBe(404);
});
test('test controls reject injected authority, untrusted origins and wrong booking/payment pairs', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const another = await f.booking(owner);
  const payment = (await owner.payments.createOnline(online(booking.id))).data;
  expect(
    (
      await f.raw(
        `/__control/f5/bookings/${another.id}`,
        { event: 'payment-success', paymentId: payment.paymentId },
        owner.accessToken,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await f.raw(
        `/__control/f5/bookings/${booking.id}`,
        { event: 'payment-success', paymentId: payment.paymentId, amount: 1 },
        owner.accessToken,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await f.raw(
        '/__control/f5/actor',
        { role: 'OWNER', propertyIds: ['journey-standard'] },
        owner.accessToken,
      )
    ).status,
  ).toBe(403);
  const origin = await fetch(f.origin() + `/__control/f5/bookings/${booking.id}`, {
    method: 'POST',
    headers: {
      origin: 'https://untrusted.invalid',
      authorization: `Bearer ${owner.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ event: 'payment-success', paymentId: payment.paymentId }),
  });
  expect(origin.status).toBe(403);
  expect((await owner.payments.status(payment.paymentId)).data.status).toBe('PENDING');
});
