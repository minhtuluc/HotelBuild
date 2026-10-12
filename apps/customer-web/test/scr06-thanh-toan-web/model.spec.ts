import { expect, test } from 'vitest';
import { booking } from '../../../../packages/web-session/test/journey-fixtures.js';
import { bookingSummarySchema, bookingBalanceSchema, paymentSchema } from '@pinehill/contracts';
import {
  approvedAmount,
  paymentMessage,
  safePaymentUrl,
  sameOffer,
  canPoll,
} from '../../src/app/(guest)/booking/[bookingId]/pay/payment-model';
const b = bookingSummarySchema.parse(booking);
const balance = bookingBalanceSchema.parse({
  bookingId: b.id,
  currency: 'VND',
  totalAmount: 1000000,
  paidAmount: 250499,
  refundedAmount: 0,
  reservedRefundAmount: 0,
  balanceDue: 749501,
  onlineDepositAmount: 49501,
});
const p = paymentSchema.parse({
  paymentId: 'p1',
  bookingId: b.id,
  type: 'DEPOSIT',
  method: 'MOMO',
  amount: 49501,
  status: 'PENDING',
  providerTxnId: null,
  paymentUrl: 'https://provider.test/pay',
  expiresAt: '2026-10-12T02:15:00Z',
  paidAt: null,
  createdAt: '2026-10-12T02:00:00Z',
});
test('only uses the server approved amount, never computes a deposit from booking totals', () => {
  expect(approvedAmount(b, balance)).toBe(49501);
  expect(approvedAmount(b, { ...balance, onlineDepositAmount: undefined })).toBeNull();
  expect(approvedAmount(b, { ...balance, onlineDepositAmount: null })).toBeNull();
  expect(approvedAmount(b, { ...balance, onlineDepositAmount: 0 })).toBeNull();
  expect(
    approvedAmount(b, { ...balance, onlineDepositAmount: Number.MAX_SAFE_INTEGER + 1 }),
  ).toBeNull();
  expect(approvedAmount(b, { ...balance, bookingId: 'foreign' })).toBeNull();
});
test('reconfirmation compares server amount/version/hold and cannot use stale confirmation', () => {
  expect(sameOffer({ booking: b, balance }, { booking: { ...b, version: 2 }, balance })).toBe(
    false,
  );
  expect(
    sameOffer(
      { booking: b, balance },
      { booking: b, balance: { ...balance, onlineDepositAmount: 50000 } },
    ),
  ).toBe(false);
  expect(sameOffer({ booking: b, balance }, { booking: b, balance })).toBe(true);
});
test('money received is separate from booking confirmation, including late callbacks', () => {
  expect(paymentMessage({ ...p, status: 'SUCCEEDED' }, { ...b, status: 'EXPIRED' })).toBe(
    'received',
  );
  expect(paymentMessage({ ...p, status: 'SUCCEEDED' }, { ...b, status: 'HELD' })).toBe('received');
  expect(paymentMessage({ ...p, status: 'SUCCEEDED' }, { ...b, status: 'CONFIRMED' })).toBe(
    'confirmed',
  );
  expect(paymentMessage({ ...p, status: 'FAILED' }, b)).toBe('failed');
  expect(paymentMessage(p, b)).toBe('pending');
});
test('redirect only consumes a safe absolute server URL; test fixture exception is exact', () => {
  expect(safePaymentUrl(p, 'http://127.0.0.1:4000')).toBe(p.paymentUrl);
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,x',
    '//evil.test',
    'http://evil.test',
    'https://user:secret@provider.test/pay',
  ])
    expect(safePaymentUrl({ ...p, paymentUrl: url }, 'http://127.0.0.1:4000')).toBeNull();
  const local = 'http://127.0.0.1:4000/__test/f5/payments/p1';
  expect(safePaymentUrl({ ...p, paymentUrl: local }, 'http://127.0.0.1:4000')).toBe(local);
  expect(safePaymentUrl({ ...p, paymentUrl: local }, undefined)).toBeNull();
  expect(
    safePaymentUrl({ ...p, paymentUrl: local + '/other' }, 'http://127.0.0.1:4000'),
  ).toBeNull();
});
test('polling is bounded and stops hidden, terminal, or at payment expiry without expiring booking', () => {
  const now = Date.parse('2026-10-12T02:00:00Z');
  expect(canPoll(p, 0, now, true)).toBe(true);
  expect(canPoll(p, 12, now, true)).toBe(false);
  expect(canPoll(p, 0, now, false)).toBe(false);
  expect(canPoll(p, 0, Date.parse(p.expiresAt!), true)).toBe(false);
  expect(canPoll({ ...p, status: 'FAILED' }, 0, now, true)).toBe(false);
});
