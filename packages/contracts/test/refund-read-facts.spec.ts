import { expect, test } from 'vitest';
import { refundRequestSchema, refundApproveRequestSchema } from '../src/refund.js';
const refund = {
  id: 'synthetic-refund',
  bookingId: 'synthetic-booking',
  paymentId: 'synthetic-original',
  policyId: 'synthetic-policy',
  hoursBeforeCheckIn: 96,
  appliedTierId: 'synthetic-tier',
  refundPercent: 50,
  requestedAmount: 652000,
  approvedAmount: 652000,
  refundFee: 100000,
  status: 'PAID',
  isForceMajeure: false,
  reason: 'GUEST_REQUEST',
  evidenceRefs: [],
  requestedBy: 'synthetic-maker',
  approvedBy: 'synthetic-checker',
  decidedAt: '2026-10-11T01:00:00Z',
  paidAt: '2026-10-11T02:00:00Z',
  createdAt: '2026-10-11T00:00:00Z',
};
const original = {
  paymentId: refund.paymentId,
  bookingId: refund.bookingId,
  type: 'DEPOSIT',
  method: 'VNPAY',
  amount: 1305000,
  status: 'SUCCEEDED',
  providerTxnId: 'synthetic-original-txn',
  paymentUrl: null,
  expiresAt: null,
  paidAt: '2026-10-10T01:00:00Z',
  createdAt: '2026-10-10T00:00:00Z',
};
test('legacy refund payload remains readable without net or allocation evidence', () => {
  expect(refundRequestSchema.parse(refund)).toEqual(refund);
});
test('HB110 preserves server net/event total and original/refund payment evidence', () => {
  const body = {
    ...refund,
    netRefund: 552000,
    eventNetRefund: 552000,
    requiresThresholdControl: false,
    refundAllocations: [
      {
        amount: 552000,
        payoutMethod: 'VNPAY',
        originalPayment: original,
        refundPayment: {
          ...original,
          paymentId: 'synthetic-refund-payment',
          type: 'REFUND',
          amount: 552000,
          providerTxnId: 'synthetic-refund-txn',
          paidAt: refund.paidAt,
        },
      },
    ],
  };
  expect(refundRequestSchema.parse(body)).toEqual(body);
  expect(original.amount).toBe(1305000);
});
test('BR-CANCEL-05 allows approved gross zero; negative or fractional amounts are invalid', () => {
  expect(refundApproveRequestSchema.safeParse({ approvedAmount: 0 }).success).toBe(true);
  expect(refundApproveRequestSchema.safeParse({ approvedAmount: -1 }).success).toBe(false);
  expect(refundApproveRequestSchema.safeParse({ approvedAmount: 0.5 }).success).toBe(false);
});
