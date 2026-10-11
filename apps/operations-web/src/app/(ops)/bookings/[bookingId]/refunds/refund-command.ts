import type { RefundRequest, Payment } from '@pinehill/contracts';
import { approvalIssue, paidEvidence, payoutMethod, refundActions } from './refund-model';
import type { RefundWorkspace, RefundData } from './refund-workspace';
import type { RefundIntent } from './refund-actions';
export const requiresPin = (intent: RefundIntent) => !['create', 'cancel'].includes(intent.action);
export const cashPayout = (intent: RefundIntent) =>
  intent.action === 'pay' &&
  intent.target?.refundAllocations?.some((value) => value.originalPayment.method === 'CASH') ===
    true;
export const eligiblePayments = (payments: Payment[] = []) =>
  payments.filter(
    (value) => value.status === 'SUCCEEDED' && ['DEPOSIT', 'BALANCE'].includes(value.type),
  );
export function firstPayment(data: RefundData | null): string {
  return eligiblePayments(data?.booking.payments)[0]?.paymentId ?? '';
}
export function intentIssue(
  intent: RefundIntent | null,
  amount: string,
  note: string,
  recipient: boolean,
): ReturnType<typeof approvalIssue> | 'RECIPIENT' {
  if (!intent) return null;
  if (intent.action === 'approve' && intent.target)
    return approvalIssue(amount, intent.target, note);
  if (['reject', 'cancel'].includes(intent.action) && !note.trim()) return 'REASON';
  return cashPayout(intent) && (!note.trim() || !recipient) ? 'RECIPIENT' : null;
}
export function canCommand(intent: RefundIntent, data: RefundData): boolean {
  if (intent.action === 'create')
    return ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'].includes(data.user.role);
  const target = data.refunds.find((value) => value.id === intent.target?.id);
  return target !== undefined && refundActions(target, data.user).includes(intent.action);
}
export function commandResolved(
  intent: RefundIntent,
  found: RefundRequest,
  userId: string,
  amount: string,
): boolean {
  switch (intent.action) {
    case 'pay':
      return paidEvidence(found);
    case 'approve':
      return (
        found.status === 'APPROVED' &&
        found.approvedBy === userId &&
        found.approvedAmount === Number(amount)
      );
    case 'reject':
      return found.status === 'REJECTED' && found.approvedBy === userId;
    case 'cancel':
      return found.status === 'CANCELLED';
    default:
      return false;
  }
}
export async function executeRefund(
  workspace: RefundWorkspace,
  intent: RefundIntent,
  fields: { amount: string; note: string; paymentId: string; payoutKey?: string },
): Promise<RefundRequest> {
  const { refunds } = workspace.api;
  const data = workspace.data!;
  const target = data.refunds.find((value) => value.id === intent.target?.id);
  const note = fields.note.trim();
  const optionalNote = note ? { note } : {};
  switch (intent.action) {
    case 'create':
      return (
        await refunds.create({
          bookingId: data.booking.id,
          paymentId: fields.paymentId,
          reason: 'GUEST_REQUEST',
          isForceMajeure: false,
          ...optionalNote,
        })
      ).data;
    case 'approve': {
      const decision = (
        await refunds.approve(target!.id, {
          approvedAmount: Number(fields.amount),
          ...optionalNote,
        })
      ).data;
      // New NET/allocations must be read from the server after approval.
      return {
        ...target!,
        ...decision,
        netRefund: undefined,
        eventNetRefund: undefined,
        requiresThresholdControl: undefined,
        refundAllocations: undefined,
      };
    }
    case 'reject':
      return (await refunds.reject(target!.id, { note })).data;
    case 'cancel':
      return (await refunds.cancel(target!.id, { reason: note })).data;
    case 'pay':
      return (
        await refunds.pay(
          target!.id,
          { method: payoutMethod(target!)!, ...(note ? { bankNote: note } : {}) },
          { idempotencyKey: fields.payoutKey! },
        )
      ).data;
  }
}
