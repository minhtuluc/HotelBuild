/** Synthetic server read facts, not a production reservation/PSP implementation. */
import type { RefundRequest, Payment } from '../../../../packages/contracts/src/index.js';
import type { FixtureState } from './state.js';
import { now } from './state.js';
export function refundNet(value: RefundRequest): number {
  return Math.max(0, (value.approvedAmount ?? value.requestedAmount) - value.refundFee);
}
export function refundFacts(state: FixtureState, value: RefundRequest): RefundRequest {
  const original = state.payments.get(value.paymentId);
  const refundPayment = state.refundPayments.get(value.id);
  const net = refundNet(value);
  return { ...value, netRefund: net,
    // Each finite fixture request is a distinct operation. No split-event policy oracle here.
    eventNetRefund: net,
    requiresThresholdControl: net > 5000000,
    ...(original ? { refundAllocations: [{ amount: net,
      payoutMethod: original.method === 'CASH' ? 'BANK_TRANSFER' : original.method,
      originalPayment: { ...original }, refundPayment: refundPayment ? { ...refundPayment } : null }] } : {}),
  };
}
export function recordRefundPayment(state: FixtureState, value: RefundRequest,
  method: Payment['method'], actor: string): void {
  const id = crypto.randomUUID();
  const payment: Payment = { paymentId: id, bookingId: value.bookingId, type: 'REFUND',
    method, amount: refundNet(value), status: 'SUCCEEDED',
    providerTxnId: `synthetic-refund-${id}`, paymentUrl: null, expiresAt: null,
    paidAt: now(), createdAt: now(), createdBy: actor };
  state.payments.set(id, payment);
  state.refundPayments.set(value.id, payment);
  const stored = state.context.getBooking?.(value.bookingId);
  if (stored) stored.value.payments = [...(stored.value.payments ?? []), payment];
}
