import { expect, test } from 'vitest';
import { refundRequestSchema } from '@pinehill/contracts';
import { setup, online } from './f5-fixtures.js';
const f = setup();
async function paid() {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const payment = (await owner.payments.createOnline(online(booking.id))).data;
  await f.control(owner, booking.id, 'payment-success', payment.paymentId);
  return { owner, booking, payment };
}
async function pending() {
  const value = await paid();
  const maker = await f.actor('synthetic-maker', 'FRONT_DESK');
  const refund = (
    await maker.refunds.create({
      bookingId: value.booking.id,
      paymentId: value.payment.paymentId,
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
    })
  ).data;
  expect(refund).toMatchObject({
    status: 'PENDING',
    requestedAmount: 150000,
    approvedAmount: null,
  });
  return { ...value, maker, refund };
}
test('approve only reserves funds; ACCOUNTANT payout changes PAID and balance exactly once', async () => {
  const { owner, booking, refund } = await pending();
  const manager = await f.actor('synthetic-manager', 'MANAGER');
  await manager.verify(booking.id);
  const decision = (await manager.refunds.approve(refund.id, { approvedAmount: 150000 })).data;
  expect(decision).toMatchObject({
    status: 'APPROVED',
    requestedAmount: 150000,
    approvedAmount: 150000,
    approvedBy: manager.name,
  });
  expect((await owner.payments.balance(booking.id)).data).toMatchObject({
    paidAmount: 300000,
    refundedAmount: 0,
    reservedRefundAmount: 150000,
  });
  const cashier = await f.actor('synthetic-accountant', 'ACCOUNTANT');
  const pin = await cashier.verify(booking.id);
  const key = crypto.randomUUID();
  const path = `/refund-requests/${refund.id}/pay`;
  const body = { method: 'VNPAY', pinToken: pin };
  const paid = await f.raw(path, body, cashier.accessToken, 'POST', key);
  expect(paid.status).toBe(200);
  const result = refundRequestSchema.parse(await paid.json());
  expect(result.status).toBe('PAID');
  const replay = await f.raw(path, body, cashier.accessToken, 'POST', key);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect(await replay.json()).toEqual(result);
  expect((await owner.payments.balance(booking.id)).data).toMatchObject({
    paidAmount: 300000,
    refundedAmount: 150000,
    reservedRefundAmount: 0,
  });
  await cashier.verify(booking.id);
  await expect(cashier.refunds.pay(refund.id, { method: 'VNPAY' })).rejects.toMatchObject({
    status: 409,
    code: 'E_PAY_REFUND_NOT_APPROVED',
  });
});
test('maker cannot approve own request and PIN cannot authorize a different command', async () => {
  const { booking, payment } = await paid();
  const manager = await f.actor('synthetic-manager', 'MANAGER');
  const refund = (
    await manager.refunds.create({
      bookingId: booking.id,
      paymentId: payment.paymentId,
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
    })
  ).data;
  await manager.verify(booking.id);
  await expect(
    manager.refunds.approve(refund.id, { approvedAmount: 150000 }),
  ).rejects.toMatchObject({ status: 403, code: 'E_PAY_SELF_APPROVAL' });
  const checker = await f.actor('synthetic-checker', 'MANAGER');
  await checker.verify(booking.id);
  await expect(
    checker.refunds.approve(refund.id, { approvedAmount: 150001 }),
  ).rejects.toMatchObject({ status: 422, code: 'E_PAY_AMOUNT_MISMATCH' });
  await checker.refunds.approve(refund.id, { approvedAmount: 150000 });
  await expect(
    checker.refunds.reject(refund.id, { note: 'Synthetic reason' }),
  ).rejects.toMatchObject({ status: 401, code: 'E_AUTH_PIN_REQUIRED' });
});
test.each(['cancel', 'reject'])(
  '%s releases reservation without restoring cancelled booking',
  async (action) => {
    const { owner, booking, payment } = await paid();
    const cancelled = (
      await owner.bookings.cancel(booking.id, { reason: 'GUEST_REQUEST', isForceMajeure: false })
    ).data;
    expect(cancelled.refundRequest).not.toBeNull();
    const id = cancelled.refundRequest!.id;
    expect((await owner.payments.balance(booking.id)).data.reservedRefundAmount).toBe(150000);
    if (action === 'cancel') await owner.refunds.cancel(id, { reason: 'Synthetic withdrawal' });
    else {
      const checker = await f.actor('synthetic-checker', 'MANAGER');
      await checker.verify(booking.id);
      await checker.refunds.reject(id, { note: 'Synthetic rejection' });
    }
    expect((await owner.payments.balance(booking.id)).data.reservedRefundAmount).toBe(0);
    expect((await owner.bookings.get(booking.id)).data.status).toBe('CANCELLED');
    const maker = await f.actor('synthetic-maker', 'FRONT_DESK');
    const next = (
      await maker.refunds.create({
        bookingId: booking.id,
        paymentId: payment.paymentId,
        reason: 'GUEST_REQUEST',
        isForceMajeure: false,
      })
    ).data;
    expect(next.requestedAmount).toBe(150000);
  },
);
test('refund authorization uses explicit role, scope, owner and original payout method', async () => {
  const { owner, booking, refund, payment, maker } = await pending();
  await expect(
    owner.refunds.create({
      bookingId: booking.id,
      paymentId: payment.paymentId,
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await maker.verify(booking.id);
  await expect(maker.refunds.approve(refund.id, { approvedAmount: 150000 })).rejects.toMatchObject({
    status: 403,
  });
  const wrongScope = await f.actor('synthetic-wrong-scope', 'MANAGER', ['unrelated']);
  expect(
    (
      await f.raw(
        `/refund-requests/${refund.id}/approve`,
        { approvedAmount: 150000, pinToken: 'synthetic-unusable-pin' },
        wrongScope.accessToken,
      )
    ).status,
  ).toBe(404);
  expect((await wrongScope.refunds.list({ bookingId: booking.id })).data.data).toEqual([]);
  const manager = await f.actor('synthetic-manager', 'MANAGER');
  await manager.verify(booking.id);
  await manager.refunds.approve(refund.id, { approvedAmount: 150000 });
  await expect(
    maker.refunds.cancel(refund.id, { reason: 'Synthetic withdrawal' }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(manager.refunds.pay(refund.id, { method: 'VNPAY' })).rejects.toMatchObject({
    status: 403,
  });
  const accountant = await f.actor('synthetic-accountant', 'ACCOUNTANT');
  await accountant.verify(booking.id);
  await expect(accountant.refunds.pay(refund.id, { method: 'CASH' })).rejects.toMatchObject({
    status: 422,
    code: 'E_PAY_AMOUNT_MISMATCH',
  });
  expect((await accountant.refunds.pay(refund.id, { method: 'VNPAY' })).data.status).toBe('PAID');
});
test('cash collection requires staff role and one-use booking PIN', async () => {
  const owner = await f.actor();
  const booking = await f.booking(owner);
  const clerk = await f.actor('synthetic-clerk', 'FRONT_DESK');
  const cash = {
    bookingId: booking.id,
    type: 'DEPOSIT' as const,
    method: 'CASH' as const,
    amount: 300000,
  };
  expect(
    (await f.raw('/payments', { ...cash, pinToken: 'synthetic-unusable-pin' }, owner.accessToken))
      .status,
  ).toBe(403);
  await expect(clerk.payments.create(cash)).rejects.toMatchObject({
    status: 401,
    code: 'E_AUTH_PIN_REQUIRED',
  });
  await clerk.verify(booking.id);
  expect((await clerk.payments.create(cash)).data.status).toBe('SUCCEEDED');
  await expect(
    clerk.payments.create({ ...cash, type: 'BALANCE', amount: 700000 }),
  ).rejects.toMatchObject({ status: 401, code: 'E_AUTH_PIN_REQUIRED' });
  expect((await owner.payments.balance(booking.id)).data.paidAmount).toBe(300000);
});
test('open refund reservations cannot spend the same collected amount twice', async () => {
  const { maker, booking, payment } = await pending();
  const body = {
    bookingId: booking.id,
    paymentId: payment.paymentId,
    reason: 'GUEST_REQUEST' as const,
    isForceMajeure: false,
  };
  await maker.refunds.create(body);
  await expect(maker.refunds.create(body)).rejects.toMatchObject({
    status: 422,
    code: 'E_PAY_REFUND_EXCEEDS_PAID',
  });
});
test.each(['EARLY_CHECKOUT', 'HOTEL_RELOCATION', 'OTA_CANCELLATION', 'SYSTEM'])(
  'unsupported %s cannot silently use the ordinary cancel tier',
  async (reason) => {
    const { booking, payment } = await paid();
    const manager = await f.actor('synthetic-manager', 'MANAGER');
    const result = await f.raw(
      '/refund-requests',
      { bookingId: booking.id, paymentId: payment.paymentId, reason, isForceMajeure: false },
      manager.accessToken,
    );
    expect(result.status).toBe(400);
    expect((await manager.refunds.list({ bookingId: booking.id })).data.data).toEqual([]);
  },
);
