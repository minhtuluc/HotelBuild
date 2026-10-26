/** SCR-38 presentation guards; the server authorizes every command and computes money. */
import type { RefundRequest, UserMe, Payment } from '@pinehill/contracts';
export type RefundAction = 'approve' | 'reject' | 'cancel' | 'pay' | 'confirm-transfer';

/**
 * Lỗi cấp biểu mẫu UI tự kiểm trước khi gửi (`REFERENCE`/`NOTE` cho lệnh xác nhận chuyển khoản —
 * HB-215). Máy chủ vẫn là nơi chặn cuối; câu chữ ở `lib/i18n.ts`.
 */
export type RefundIssue = 'FORMAT' | 'OVER' | 'REASON' | 'RECIPIENT' | 'REFERENCE' | 'NOTE';
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
/** Hồ sơ đã duyệt: chỉ ACCOUNTANT thao tác, và chỉ một đường (xác nhận chuyển khoản tay hoặc chi). */
function approvedActions(request: RefundRequest, user: UserMe): RefundAction[] {
  if (user.role !== 'ACCOUNTANT') return [];
  // HB-215: server báo leg chuyển khoản tay đang chờ xác nhận ⇒ kế toán xác nhận, không chi lại.
  if (request.awaitingTransferConfirmation === true) return ['confirm-transfer'];
  return payoutMethod(request) === null ? [] : ['pay'];
}
export function refundActions(request: RefundRequest, user: UserMe): RefundAction[] {
  if (request.status === 'APPROVED') return approvedActions(request, user);
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

/**
 * HB-215: lệnh chi cũ còn dấu trong trình duyệt cần tra cứu **trừ khi** server đã báo leg đang chờ
 * kế toán xác nhận chuyển khoản — trạng thái đó là đã biết, không phải "chưa xác định kết quả", nên
 * màn hình phải mở lại nội dung để hiện lệnh xác nhận.
 */
export function payoutLookupRequired(request: RefundRequest): boolean {
  return !paidEvidence(request) && request.awaitingTransferConfirmation !== true;
}
