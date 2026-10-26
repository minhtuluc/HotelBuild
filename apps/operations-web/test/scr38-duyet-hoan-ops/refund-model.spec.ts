import { expect, test } from 'vitest';
import type { RefundRequest, UserMe } from '@pinehill/contracts';
import {
  refundActions,
  paidEvidence,
  payoutLookupRequired,
  approvalIssue,
  payoutMethod,
} from '../../src/app/(ops)/bookings/[bookingId]/refunds/refund-model';
const user: UserMe = {
  userId: 'checker',
  username: 'synthetic-checker',
  fullName: 'Synthetic',
  role: 'MANAGER',
  propertyScope: ['property'],
  hasPin: true,
  mustChangePassword: false,
};
const original = {
  paymentId: 'original',
  bookingId: 'booking',
  type: 'DEPOSIT' as const,
  method: 'VNPAY' as const,
  amount: 300000,
  status: 'SUCCEEDED' as const,
  providerTxnId: 'original-txn',
  paymentUrl: null,
  expiresAt: null,
  paidAt: '2026-10-11T00:00:00Z',
  createdAt: '2026-10-11T00:00:00Z',
};
const request: RefundRequest = {
  id: 'refund',
  bookingId: 'booking',
  paymentId: 'original',
  policyId: 'policy',
  hoursBeforeCheckIn: 96,
  appliedTierId: 'tier',
  refundPercent: 50,
  requestedAmount: 150000,
  approvedAmount: null,
  refundFee: 10000,
  netRefund: 140000,
  eventNetRefund: 140000,
  requiresThresholdControl: false,
  refundAllocations: [
    { amount: 140000, payoutMethod: 'VNPAY', originalPayment: original, refundPayment: null },
  ],
  status: 'PENDING',
  isForceMajeure: false,
  reason: 'GUEST_REQUEST',
  evidenceRefs: [],
  requestedBy: 'maker',
  approvedBy: null,
  decidedAt: null,
  paidAt: null,
  createdAt: '2026-10-11T00:00:00Z',
};
test('maker has no approval control even as OWNER; checker has approve/reject/cancel controls', () => {
  expect(refundActions(request, { ...user, userId: 'maker', role: 'OWNER' })).toEqual(['cancel']);
  expect(refundActions(request, user)).toEqual(['approve', 'reject', 'cancel']);
  expect(refundActions(request, { ...user, role: 'ACCOUNTANT' })).toEqual([]);
});
test('only accountant presents pay on approved server allocation; PAID never presents pay', () => {
  const approved = { ...request, status: 'APPROVED' as const, approvedAmount: 150000 };
  expect(refundActions(approved, user)).toEqual([]);
  expect(refundActions(approved, { ...user, role: 'ACCOUNTANT' })).toEqual(['pay']);
  expect(refundActions({ ...approved, status: 'PAID' }, { ...user, role: 'ACCOUNTANT' })).toEqual(
    [],
  );
});
test('approval accepts zero gross, rejects fraction/unsafe/over ceiling and reduced without reason', () => {
  expect(approvalIssue('0', request, 'Synthetic reduction')).toBeNull();
  expect(approvalIssue('150000', request, '')).toBeNull();
  for (const value of ['-1', '1.5', '9007199254740992', '150001', ''])
    expect(approvalIssue(value, request, 'reason')).not.toBeNull();
  expect(approvalIssue('100000', request, '')).toBe('REASON');
});
function paid(): RefundRequest {
  return {
    ...request,
    status: 'PAID',
    approvedAmount: 150000,
    paidAt: '2026-10-11T01:00:00Z',
    refundAllocations: [
      {
        ...request.refundAllocations![0]!,
        refundPayment: {
          ...original,
          paymentId: 'refund-payment',
          type: 'REFUND',
          amount: 140000,
          providerTxnId: 'refund-txn',
        },
      },
    ],
  };
}
test('only linked successful REFUND payment proves PAID; reason attachment is not payout proof', () => {
  expect(paidEvidence(paid())).toBe(true);
  expect(paidEvidence({ ...request, status: 'PAID', evidenceRefs: ['reason-document'] })).toBe(
    false,
  );
  const value = paid();
  const allocation = value.refundAllocations![0]!;
  for (const patch of [
    { status: 'PENDING' as const },
    { type: 'DEPOSIT' as const },
    { bookingId: 'foreign' },
    { amount: 140001 },
    { paymentId: 'original' },
    { paidAt: null },
  ]) {
    expect(
      paidEvidence({
        ...value,
        refundAllocations: [
          { ...allocation, refundPayment: { ...allocation.refundPayment!, ...patch } },
        ],
      }),
    ).toBe(false);
  }
});
test('multi-source proof totals match NET and unique payout receipt; incompatible command methods fail closed', () => {
  const value = paid();
  const allocation = value.refundAllocations![0]!;
  const first = {
    ...allocation,
    amount: 70000,
    refundPayment: { ...allocation.refundPayment!, amount: 70000 },
  };
  const second = {
    ...first,
    originalPayment: { ...original, paymentId: 'original-2', method: 'MOMO' as const },
    payoutMethod: 'MOMO' as const,
    refundPayment: { ...first.refundPayment, paymentId: 'refund-2', method: 'MOMO' as const },
  };
  const multi = { ...value, refundAllocations: [first, second] };
  expect(paidEvidence(multi)).toBe(true);
  expect(
    payoutMethod({
      ...multi,
      status: 'APPROVED',
      refundAllocations: [
        { ...first, refundPayment: null },
        { ...second, refundPayment: null },
      ],
    }),
  ).toBeNull();
  expect(paidEvidence({ ...multi, netRefund: 140001 })).toBe(false);
  expect(paidEvidence({ ...multi, refundAllocations: [first, first] })).toBe(false);
});
test('missing facts or existing payout attempt disables new payout; zero NET never pays', () => {
  expect(payoutMethod({ ...request, status: 'APPROVED' })).toBe('VNPAY');
  expect(payoutMethod({ ...request, netRefund: undefined })).toBeNull();
  expect(payoutMethod({ ...request, netRefund: 0 })).toBeNull();
  expect(payoutMethod(paid())).toBeNull();
});

test('missing server threshold decision disables approval even with money facts', () => {
  expect(refundActions({ ...request, requiresThresholdControl: undefined }, user)).toEqual([
    'cancel',
  ]);
});
test('only accountant sees confirm-transfer, and only when the server reports a parked leg', () => {
  const approved = { ...request, status: 'APPROVED' as const, approvedAmount: 150000 };
  const parked = { ...approved, awaitingTransferConfirmation: true };
  const accountant = { ...user, role: 'ACCOUNTANT' as const };
  expect(refundActions(parked, accountant)).toEqual(['confirm-transfer']);
  expect(refundActions(parked, user)).toEqual([]);
  expect(refundActions(parked, { ...user, userId: 'maker', role: 'OWNER' })).toEqual([]);
  // Cờ tắt ⇒ quay lại đường chi thường; đã PAID hoặc chưa duyệt ⇒ không có nút nào.
  expect(refundActions({ ...parked, awaitingTransferConfirmation: false }, accountant)).toEqual([
    'pay',
  ]);
  expect(refundActions({ ...parked, awaitingTransferConfirmation: undefined }, accountant)).toEqual(
    ['pay'],
  );
  expect(refundActions({ ...parked, status: 'PAID' }, accountant)).toEqual([]);
  expect(refundActions({ ...parked, status: 'PENDING' }, accountant)).toEqual([]);
});
test('leg chờ xác nhận chuyển khoản không còn bị coi là lệnh chi chưa rõ kết quả', () => {
  const approved = { ...request, status: 'APPROVED' as const, approvedAmount: 150000 };
  expect(payoutLookupRequired(approved)).toBe(true);
  expect(payoutLookupRequired({ ...approved, awaitingTransferConfirmation: true })).toBe(false);
  expect(payoutLookupRequired(paid())).toBe(false);
});
