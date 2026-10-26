/** Dựng hợp đồng trả về của lệnh chi hoàn (HB-100; api.md §2.6). Tiền đổi sang number nguyên ở server. */
import { vnd } from '../refunds/view.js';
import type { PayoutRow } from './writes.js';

export interface PayoutOperationView {
  id: string;
  status: string;
  method: string;
  amount: number;
  originalPaymentId: string;
  refundPaymentId: string;
  bankNote: string | null;
  attempts: number;
  providerTxnId: string | null;
  /**
   * HB-215: lý do kỹ thuật gần nhất (vd. `MANUAL_TRANSFER_AWAITING_CONFIRMATION`); `null` khi chốt
   * xong. Không chứa số tài khoản hay `pinToken`.
   */
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface RefundPayoutView {
  refundRequestId: string;
  /** Trạng thái **nghiệp vụ** của hồ sơ: vẫn `APPROVED` cho tới khi mọi leg chi xong. */
  status: string;
  operations: PayoutOperationView[];
}

function operationView(row: PayoutRow): PayoutOperationView {
  return {
    id: row.id,
    status: row.status,
    method: row.method,
    amount: vnd(row.amount),
    originalPaymentId: row.original_payment_id,
    refundPaymentId: row.refund_payment_id,
    bankNote: row.bank_note,
    attempts: row.attempts,
    providerTxnId: row.provider_txn_id,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

export function payoutView(
  refundRequestId: string,
  status: string,
  rows: readonly PayoutRow[],
): RefundPayoutView {
  return { refundRequestId, status, operations: rows.map(operationView) };
}
