/**
 * Ghi chuẩn bị chi hoàn (HB-100; ADR-016 "Chuẩn bị chi"). Mọi lệnh chạy trong transaction của caller;
 * thứ tự khoá booking → payments → refund_requests do `BookingLedger.read` giữ trước khi chạm allocation.
 */
import { refundFailure } from '../refunds/writes.js';
import type { Tx } from '../refunds/writes.js';
import { refundError } from '../refunds/validation.js';
import { payoutError } from './validation.js';

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

/**
 * Khoá `refund_allocations` của hồ sơ theo thứ tự ADR-014 trước khi chốt leg; `BookingLedger.read`
 * đã khoá booking → payments → refund_requests nên dãy khoá vẫn đúng thứ tự quy định.
 */
export async function lockAllocations(tx: Tx, refundRequestId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM refund_allocations
     WHERE refund_request_id = ${refundRequestId}::uuid ORDER BY id FOR UPDATE`;
}

/** Khoá operation của hồ sơ (`FOR UPDATE`) — bước cuối trong thứ tự khoá ADR-014. */
export async function lockPayoutOperations(tx: Tx, refundRequestId: string): Promise<PayoutRow[]> {
  return tx.$queryRaw<PayoutRow[]>`
    SELECT * FROM refund_payout_operations
     WHERE refund_request_id = ${refundRequestId}::uuid
     ORDER BY created_at, id FOR UPDATE`;
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

/**
 * HB-215 — chốt một leg đã được kế toán xác nhận chuyển khoản. Port đúng chuỗi SQL của worker
 * (`apps/worker/src/jobs/refund-payout/settle.ts`) vì API không import được worker: chứng từ
 * `Payment REFUND` → `SUCCEEDED` + `provider_txn_id` + `paid_at`, operation → `SUCCEEDED` +
 * `provider_txn_id` + `finished_at`, xoá `last_error`. `WHERE … status = 'PENDING'/'UNKNOWN'` là
 * hàng rào chống chốt hai lần; lệch trạng thái ⇒ rollback và đối soát tay (TD trùng lặp mã nguồn).
 */
export async function settleTransferLeg(
  tx: Tx,
  operation: PayoutRow,
  bankReference: string,
  now: Date,
): Promise<void> {
  const paid = await tx.$executeRaw`
    UPDATE payments
       SET status = 'SUCCEEDED', provider_txn_id = ${bankReference}, paid_at = ${now}::timestamptz,
           updated_at = ${now}::timestamptz
     WHERE id = ${operation.refund_payment_id}::uuid AND status = 'PENDING'`;
  if (paid !== 1)
    throw payoutError('gateway', 'Chứng từ chi không còn chờ; cần đối soát thủ công.');
  const settled = await tx.$executeRaw`
    UPDATE refund_payout_operations
       SET status = 'SUCCEEDED', provider_txn_id = ${bankReference}, finished_at = ${now}::timestamptz,
           lease_token = NULL, lease_expires_at = NULL, last_error = NULL,
           updated_at = ${now}::timestamptz
     WHERE id = ${operation.id}::uuid AND status = 'UNKNOWN'`;
  if (settled !== 1) throw payoutError('gateway', 'Thao tác chi đã đổi trạng thái; cần đối soát.');
}

/**
 * Hồ sơ chỉ `PAID` khi **mọi** allocation có chứng từ chi `SUCCEEDED` — cùng luật
 * `markPaidIfComplete` của worker; trigger `fn_guard_refund_request` kiểm lại tổng đã chi.
 */
export async function markPaidIfComplete(
  tx: Tx,
  refundRequestId: string,
  now: Date,
): Promise<string> {
  const remaining = await tx.$queryRaw<{ pending: bigint }[]>`
    SELECT count(*)::bigint AS pending
      FROM refund_allocations a JOIN payments p ON p.id = a.refund_payment_id
     WHERE a.refund_request_id = ${refundRequestId}::uuid AND p.status <> 'SUCCEEDED'`;
  if (BigInt(remaining[0]?.pending ?? 0n) !== 0n) return 'APPROVED';
  await tx.$executeRaw`
    UPDATE refund_requests SET status = 'PAID', paid_at = ${now}::timestamptz,
           updated_at = ${now}::timestamptz
     WHERE id = ${refundRequestId}::uuid AND status = 'APPROVED'`;
  const current = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM refund_requests WHERE id = ${refundRequestId}::uuid`;
  return current[0]?.status ?? 'PAID';
}

/** Giữ đúng định nghĩa `BookingLedger`: tổng allocation có chứng từ chi SUCCEEDED của booking. */
export async function syncRefundedAmount(tx: Tx, bookingId: string, now: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE bookings b
       SET refunded_amount = (
             SELECT coalesce(sum(a.amount), 0) FROM refund_allocations a
               JOIN refund_requests r ON r.id = a.refund_request_id
               JOIN payments p ON p.id = a.refund_payment_id
              WHERE r.booking_id = b.id AND p.status = 'SUCCEEDED'),
           updated_at = ${now}::timestamptz
     WHERE b.id = ${bookingId}::uuid`;
}

/**
 * `RefundPaid` cùng payload với worker (`settle.ts`): tổng `net_refund` + mọi leg `SUCCEEDED`, để
 * consumer/đối soát không phân biệt leg được chốt bởi PSP hay bởi kế toán xác nhận tay.
 */
export async function insertRefundPaidEvent(
  tx: Tx,
  refundRequestId: string,
  bookingId: string,
  now: Date,
): Promise<void> {
  const request = await tx.$queryRaw<{ net_refund: bigint | null }[]>`
    SELECT net_refund FROM refund_requests WHERE id = ${refundRequestId}::uuid`;
  const legs = await tx.$queryRaw<
    { amount: bigint; method: string; provider_txn_id: string | null }[]
  >`
    SELECT amount, method, provider_txn_id FROM refund_payout_operations
     WHERE refund_request_id = ${refundRequestId}::uuid AND status = 'SUCCEEDED'
     ORDER BY created_at, id`;
  await tx.outbox_events.create({
    data: {
      event_type: 'RefundPaid',
      aggregate_type: 'RefundRequest',
      aggregate_id: refundRequestId,
      payload_json: {
        refundRequestId,
        bookingId,
        amount: BigInt(request[0]?.net_refund ?? 0n).toString(),
        legs: legs.map((leg) => ({
          amount: leg.amount.toString(),
          method: leg.method,
          providerTxnId: leg.provider_txn_id,
        })),
      },
      created_at: now,
      updated_at: now,
    },
  });
}
