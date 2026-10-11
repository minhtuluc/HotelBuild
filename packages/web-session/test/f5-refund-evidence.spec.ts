import { expect, test } from 'vitest';
import { setup, online } from './f5-fixtures.js';
const f = setup();
async function pending(withFee = false) {
  const guest = await f.actor();
  const booking = await f.booking(guest);
  const original = (await guest.payments.createOnline(online(booking.id))).data;
  await f.control(guest, booking.id, 'payment-success', original.paymentId);
  if (withFee) await f.control(guest, booking.id, 'refund-fee-sample');
  const maker = await f.actor('synthetic-maker', 'FRONT_DESK');
  const refund = (
    await maker.refunds.create({
      bookingId: booking.id,
      paymentId: original.paymentId,
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
    })
  ).data;
  return { guest, booking, original, refund };
}
test('fake payout creates one linked successful REFUND payment, preserving collected receipt on replay', async () => {
  const { guest, booking, original, refund } = await pending();
  const manager = await f.actor('synthetic-manager', 'MANAGER');
  await manager.verify(booking.id);
  await manager.refunds.approve(refund.id, { approvedAmount: 150000 });
  const cashier = await f.actor('synthetic-cashier', 'ACCOUNTANT');
  const pin = await cashier.verify(booking.id);
  const body = { method: 'VNPAY', pinToken: pin };
  const key = crypto.randomUUID();
  const path = `/refund-requests/${refund.id}/pay`;
  const response = await f.raw(path, body, cashier.accessToken, 'POST', key);
  expect(response.status).toBe(200);
  const result = (await cashier.refunds.list({ bookingId: booking.id })).data.data[0]!;
  expect(result).toMatchObject({
    status: 'PAID',
    netRefund: 150000,
    eventNetRefund: 150000,
    refundAllocations: [
      {
        amount: 150000,
        payoutMethod: 'VNPAY',
        originalPayment: {
          paymentId: original.paymentId,
          amount: 300000,
          type: 'DEPOSIT',
          status: 'SUCCEEDED',
        },
        refundPayment: {
          type: 'REFUND',
          amount: 150000,
          status: 'SUCCEEDED',
          createdBy: cashier.name,
        },
      },
    ],
  });
  const replay = await f.raw(path, body, cashier.accessToken, 'POST', key);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect(await replay.json()).toEqual(await response.json());
  expect((await guest.payments.status(original.paymentId)).data).toMatchObject({
    amount: 300000,
    status: 'SUCCEEDED',
  });
  const detail = (await guest.bookings.get(booking.id)).data;
  expect(detail.payments?.filter((payment) => payment.type === 'REFUND')).toHaveLength(1);
  expect((await guest.payments.balance(booking.id)).data).toMatchObject({
    paidAmount: 300000,
    refundedAmount: 150000,
    reservedRefundAmount: 0,
  });
});
test('server fee snapshot reserves and pays NET, reducing reservation once at approval', async () => {
  const { guest, booking, refund } = await pending(true);
  expect(refund).toMatchObject({ requestedAmount: 150000, refundFee: 10000, netRefund: 140000 });
  expect((await guest.payments.balance(booking.id)).data.reservedRefundAmount).toBe(140000);
  const manager = await f.actor('synthetic-manager', 'MANAGER');
  await manager.verify(booking.id);
  await manager.refunds.approve(refund.id, { approvedAmount: 100000, note: 'Synthetic reduction' });
  expect((await guest.payments.balance(booking.id)).data).toMatchObject({
    refundedAmount: 0,
    reservedRefundAmount: 90000,
  });
  const cashier = await f.actor('synthetic-cashier', 'ACCOUNTANT');
  await cashier.verify(booking.id);
  const result = (await cashier.refunds.pay(refund.id, { method: 'VNPAY' })).data;
  expect(result).toMatchObject({
    approvedAmount: 100000,
    netRefund: 90000,
    eventNetRefund: 90000,
    refundAllocations: [
      { amount: 90000, refundPayment: { amount: 90000, type: 'REFUND', status: 'SUCCEEDED' } },
    ],
  });
  expect((await guest.payments.balance(booking.id)).data).toMatchObject({
    paidAmount: 300000,
    refundedAmount: 90000,
    reservedRefundAmount: 0,
  });
});
