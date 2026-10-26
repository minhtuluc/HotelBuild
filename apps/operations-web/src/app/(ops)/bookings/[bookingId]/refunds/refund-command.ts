import type { ApiError } from '@pinehill/api-client';
import type {
  RefundConfirmTransferRequest,
  RefundPayoutView,
  RefundRequest,
  Payment,
} from '@pinehill/contracts';
import type { ScreenState } from '@pinehill/ui-web';
import { t } from '../../../../../lib/i18n';
import {
  approvalIssue,
  paidEvidence,
  payoutMethod,
  refundActions,
  type RefundIssue,
} from './refund-model';
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
/** Lỗi của các lệnh quyết định (duyệt/từ chối/rút): lý do bắt buộc khi giảm mức hoặc rút. */
function commandIssue(intent: RefundIntent, amount: string, note: string): RefundIssue | null {
  if (intent.action === 'approve')
    return intent.target === null ? null : approvalIssue(amount, intent.target, note);
  if (intent.action === 'create') return null;
  return note.trim().length === 0 ? 'REASON' : null;
}

export function intentIssue(
  intent: RefundIntent | null,
  amount: string,
  note: string,
  recipient: boolean,
  bankReference: string,
): RefundIssue | null {
  if (intent === null) return null;
  // HB-215: mã tham chiếu bắt buộc; ngoài mã phải có ghi chú/bằng chứng (khớp cổng server).
  if (intent.action === 'confirm-transfer')
    return !bankReference.trim() ? 'REFERENCE' : note.trim().length === 0 ? 'NOTE' : null;
  if (intent.action !== 'pay') return commandIssue(intent, amount, note);
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
    case 'confirm-transfer':
      // Chỉ máy chủ quyết định đã chốt: hồ sơ `PAID` và không còn leg chờ xác nhận.
      return found.status === 'PAID' && found.awaitingTransferConfirmation !== true;
    default:
      return false;
  }
}

/**
 * Body của lệnh xác nhận chuyển khoản (HB-215): mã tham chiếu **trim** và bắt buộc; ghi chú rỗng thì
 * bỏ hẳn trường thay vì gửi chuỗi trắng (server trả `400` khi thiếu cả ghi chú lẫn minh chứng).
 */
export function transferEvidence(
  bankReference: string,
  note: string,
): RefundConfirmTransferRequest {
  const reference = bankReference.trim();
  const trimmed = note.trim();
  return { bankReference: reference, ...(trimmed ? { note: trimmed } : {}) };
}

/**
 * Lỗi của lệnh xác nhận chuyển khoản hiện **nguyên văn** `message` máy chủ (api.md §4.1) thay vì tự
 * suy kết quả; 401/403 và lỗi mạng để luồng chung quyết định (khoá/mất phạm vi/chưa xác định).
 */
export function transferFailure(caught: ApiError): ScreenState | null {
  if (caught.kind !== 'http') return null;
  if (![400, 409, 422].includes(caught.status ?? 0)) return null;
  return {
    kind: 'validationError',
    details: [{ field: t('ops.refunds.field.bankReference'), issue: caught.message }],
  };
}

export async function executeRefund(
  workspace: RefundWorkspace,
  intent: RefundIntent,
  fields: {
    amount: string;
    note: string;
    paymentId: string;
    payoutKey?: string;
    bankReference?: string;
  },
): Promise<RefundRequest | RefundPayoutView> {
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
    case 'confirm-transfer':
      // Server chốt leg và trả trạng thái kỹ thuật; hồ sơ `PAID` được đọc lại, không suy ở client.
      return (
        await refunds.confirmTransfer(
          target!.id,
          transferEvidence(fields.bankReference ?? '', note),
        )
      ).data;
  }
}

/** Hẹp kiểu phản hồi của lệnh xác nhận chuyển khoản (`/pay` và các lệnh khác trả `RefundRequest`). */
export function isRefundPayoutView(
  value: RefundRequest | RefundPayoutView,
): value is RefundPayoutView {
  return 'refundRequestId' in value;
}
