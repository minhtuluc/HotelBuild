/**
 * Ghi chuẩn bị chi hoàn (HB-100; ADR-016 "Chuẩn bị chi"). Mọi lệnh chạy trong transaction của caller;
 * thứ tự khoá booking → payments → refund_requests do `BookingLedger.read` giữ trước khi chạm allocation.
 */
import { refundFailure } from '../refunds/writes.js';
import type { Tx } from '../refunds/writes.js';
import { refundError } from '../refunds/validation.js';

/** Một nguồn hoàn của hồ sơ: allocation + chứng từ thu gốc. */
export interface RefundLegRow {
  id: string;
  amount: bigint;
  refund_payment_id: string | null;
  original_payment_id: string;
  original_method: string;
}

/** Dòng `refund_payout_operations` (SELECT *): trạng thái kỹ thuật của một leg. */
export interface PayoutRow {
  id: string;
  refund_request_id: string;
  refund_allocation_id: string;
  original_payment_id: string;
  refund_payment_id: string;
  method: string;
  amount: bigint;
  bank_note: string | null;
  status: string;
  psp_key: string;
  provider_txn_id: string | null;
  attempts: number;
  lease_token: string | null;
  version: bigint;
  last_error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

export async function legsOf(tx: Tx, refundRequestId: string): Promise<RefundLegRow[]> {
  return tx.$queryRaw<RefundLegRow[]>`
    SELECT a.id, a.amount, a.refund_payment_id, a.original_payment_id, p.method AS original_method
      FROM refund_allocations a JOIN payments p ON p.id = a.original_payment_id
     WHERE a.refund_request_id = ${refundRequestId}::uuid
     ORDER BY a.id`;
}

export async function payoutOperations(tx: Tx, refundRequestId: string): Promise<PayoutRow[]> {
  return tx.$queryRaw<PayoutRow[]>`
    SELECT * FROM refund_payout_operations
     WHERE refund_request_id = ${refundRequestId}::uuid
     ORDER BY created_at, id`;
}

export interface NewPayoutLeg {
  readonly bookingId: string;
  readonly refundRequestId: string;
  readonly allocationId: string;
  readonly originalPaymentId: string;
  readonly method: string;
  readonly amount: bigint;
  readonly bankNote: string | null;
  readonly actorId: string;
  readonly now: Date;
}

/**
 * Tạo **một** chứng từ `Payment REFUND PENDING` + operation READY + liên kết allocation trong một câu
 * lệnh: trigger `trg_refund_allocations_guard` chỉ cho gắn `refund_payment_id` đúng một lần và đòi
 * phương thức khớp nguồn gốc (CASH → BANK_TRANSFER kèm ghi chú), nên sai lệch là rollback cả ba bảng.
 * `psp_key` bền theo chứng từ chi — retry dùng lại đúng khoá này, không sinh key thứ hai.
 */
export async function insertPayoutLeg(tx: Tx, leg: NewPayoutLeg): Promise<PayoutRow> {
  const paymentKey = `refund-payout:${leg.refundRequestId}:${leg.allocationId}`;
  const rows = await tx.$queryRaw<PayoutRow[]>`
    WITH receipt AS (
      INSERT INTO payments(booking_id, type, method, amount, status, idempotency_key, note,
        created_by, created_at, updated_at)
      VALUES(${leg.bookingId}::uuid, 'REFUND', ${leg.method}, ${-leg.amount}, 'PENDING',
        ${paymentKey}, ${leg.bankNote}, ${leg.actorId}::uuid, ${leg.now}::timestamptz, ${leg.now}::timestamptz)
      RETURNING id
    ), linked AS (
      UPDATE refund_allocations SET refund_payment_id = receipt.id, updated_at = ${leg.now}::timestamptz
        FROM receipt WHERE refund_allocations.id = ${leg.allocationId}::uuid
      RETURNING refund_allocations.id, refund_allocations.refund_request_id,
        refund_allocations.original_payment_id
    )
    INSERT INTO refund_payout_operations(refund_request_id, refund_allocation_id, original_payment_id,
      refund_payment_id, method, amount, bank_note, status, psp_key, created_at, updated_at)
    SELECT linked.refund_request_id, linked.id, linked.original_payment_id, receipt.id, ${leg.method},
      ${leg.amount}, ${leg.bankNote}, 'READY', 'refund-payout:' || receipt.id::text,
      ${leg.now}::timestamptz, ${leg.now}::timestamptz
      FROM receipt, linked
    RETURNING *`;
  const row = rows[0];
  if (!row) throw refundError('invalid', 'Không tạo được thao tác chi hoàn.');
  return row;
}

export type { Tx };
export { refundFailure };
