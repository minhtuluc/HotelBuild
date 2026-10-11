/** SCR-38 presentation guards; the server authorizes every command and computes money. */
import type { RefundRequest, UserMe, Payment } from '@pinehill/contracts';
export type RefundAction = 'approve' | 'reject' | 'cancel' | 'pay';
const money = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value >= 0;
function validSource(
  request: RefundRequest,
  allocation: NonNullable<RefundRequest['refundAllocations']>[number],
): boolean {
  const original = allocation.originalPayment;
  return (
    money(allocation.amount) &&
    original.bookingId === request.bookingId &&
    original.status === 'SUCCEEDED' &&
    ['DEPOSIT', 'BALANCE'].includes(original.type) &&
    money(original.amount) &&
    allocation.amount <= original.amount
  );
}
export function refundFactsReady(request: RefundRequest): boolean {
  if (
    !money(request.netRefund) ||
    !money(request.eventNetRefund) ||
    request.eventNetRefund < request.netRefund
  )
    return false;
  const allocations = request.refundAllocations;
  if (!allocations?.length) return false;
  let total = 0;
  for (const allocation of allocations) {
    if (!validSource(request, allocation)) return false;
    total += allocation.amount;
  }
  return money(total) && total === request.netRefund;
}
export function payoutMethod(request: RefundRequest): Payment['method'] | null {
  if (request.status !== 'APPROVED' || !refundFactsReady(request) || request.netRefund === 0)
    return null;
  const allocations = request.refundAllocations!;
  if (allocations.some((value) => value.refundPayment !== null)) return null;
  const methods = new Set(allocations.map((value) => value.payoutMethod));
  // The published command carries one method. Multi-method payouts remain in reconciliation.
  return methods.size === 1 ? allocations[0]!.payoutMethod : null;
}
export function refundDecisionReady(request: RefundRequest): boolean {
  return refundFactsReady(request) && typeof request.requiresThresholdControl === 'boolean';
}
export function refundActions(request: RefundRequest, user: UserMe): RefundAction[] {
  if (request.status === 'APPROVED')
    return user.role === 'ACCOUNTANT' && payoutMethod(request) !== null ? ['pay'] : [];
  if (request.status !== 'PENDING') return [];
  const checker = ['MANAGER', 'OWNER'].includes(user.role);
  const result: RefundAction[] =
    checker && request.requestedBy !== user.userId && refundDecisionReady(request)
      ? ['approve', 'reject']
      : [];
  if (checker || request.requestedBy === user.userId) result.push('cancel');
  return result;
}
export function approvalIssue(
  raw: string,
  request: RefundRequest,
  note: string,
): 'FORMAT' | 'OVER' | 'REASON' | null {
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(Number(raw))) return 'FORMAT';
  const amount = Number(raw);
  if (amount > request.requestedAmount) return 'OVER';
  return amount < request.requestedAmount && !note.trim() ? 'REASON' : null;
}
function successfulProof(
  request: RefundRequest,
  allocation: NonNullable<RefundRequest['refundAllocations']>[number],
): boolean {
  const proof = allocation.refundPayment;
  const original = allocation.originalPayment;
  return (
    proof !== null &&
    proof.paymentId !== original.paymentId &&
    proof.bookingId === request.bookingId &&
    proof.type === 'REFUND' &&
    proof.status === 'SUCCEEDED' &&
    proof.paidAt !== null &&
    proof.amount === allocation.amount &&
    proof.method === allocation.payoutMethod
  );
}
export function paidEvidence(request: RefundRequest): boolean {
  if (request.status !== 'PAID' || !refundFactsReady(request) || request.netRefund === 0)
    return false;
  const allocations = request.refundAllocations!;
  const ids = allocations.map((value) => value.refundPayment?.paymentId);
  return (
    new Set(ids).size === allocations.length &&
    allocations.every((value) => successfulProof(request, value))
  );
}
