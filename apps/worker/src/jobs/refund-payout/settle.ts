/**
 * Chốt một leg chi hoàn đã được PSP xác nhận (HB-100; ADR-016 "Đã chi một leg").
 *
 * Cùng một transaction, sau khi khoá theo đúng thứ tự ADR-014 (booking → payments → refund_requests):
 * `Payment REFUND` → SUCCEEDED, operation → SUCCEEDED, hồ sơ → PAID khi **mọi** leg đã SUCCEEDED,
 * đồng bộ `bookings.refunded_amount`, ghi `audit_logs` và `RefundPaid` ra outbox.
 *
 * Hai hàng rào chống chi lần hai: (1) `UPDATE payments … WHERE status='PENDING'` chỉ thắng một lần;
 * (2) câu chốt operation khoá theo `lease_token + version` nên worker đã mất lease (lượt khác đã nhận
 * việc) ném `StalePayoutLease` và rollback toàn bộ.
 */
import type { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { ClaimedPayout } from './types.js';

export const STALE_PAYOUT_LEASE = 'STALE_PAYOUT_LEASE';

export class StalePayoutLease extends Error {
  constructor() {
    super(STALE_PAYOUT_LEASE);
    this.name = 'StalePayoutLease';
  }
}

export interface TransferEvidence {
  readonly providerTxnId: string;
}

type Tx = Prisma.TransactionClient;

/** Khoá booking/payments/refund (thứ tự ADR-014) rồi operation theo lease+version; trả booking id. */
async function lockForSettlement(tx: Tx, op: ClaimedPayout): Promise<string> {
  const request = await tx.$queryRaw<{ booking_id: string }[]>`
    SELECT booking_id FROM refund_requests WHERE id = ${op.refundRequestId}::uuid`;
  const bookingId = request[0]?.booking_id;
  if (bookingId === undefined) throw new StalePayoutLease();
  await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM payments WHERE booking_id = ${bookingId}::uuid ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM refund_requests WHERE booking_id = ${bookingId}::uuid ORDER BY id FOR UPDATE`;
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM refund_payout_operations
     WHERE id = ${op.id}::uuid AND lease_token = ${op.leaseToken}::uuid AND version = ${op.version}
     FOR UPDATE`;
  if (locked.length !== 1) throw new StalePayoutLease();
  return bookingId;
}

/** `RefundPaid` phải đối soát được **toàn hồ sơ**: tổng `net_refund` + mọi leg đã chi. */
async function paidPayload(
  tx: Tx,
  op: ClaimedPayout,
): Promise<{
  amount: bigint;
  legs: { amount: bigint; method: string; provider_txn_id: string | null }[];
}> {
  const request = await tx.$queryRaw<{ net_refund: bigint | null }[]>`
    SELECT net_refund FROM refund_requests WHERE id = ${op.refundRequestId}::uuid`;
  const legs = await tx.$queryRaw<
    { amount: bigint; method: string; provider_txn_id: string | null }[]
  >`
    SELECT amount, method, provider_txn_id FROM refund_payout_operations
     WHERE refund_request_id = ${op.refundRequestId}::uuid AND status = 'SUCCEEDED'
     ORDER BY created_at, id`;
  return { amount: BigInt(request[0]?.net_refund ?? 0n), legs };
}

/** Chỉ `PAID` khi mọi allocation của hồ sơ đã có chứng từ SUCCEEDED (trigger DB cũng kiểm lại). */
async function markPaidIfComplete(
  tx: Tx,
  op: ClaimedPayout,
  bookingId: string,
  now: Date,
): Promise<string> {
  const remaining = await tx.$queryRaw<{ pending: bigint }[]>`
    SELECT count(*)::bigint AS pending
      FROM refund_allocations a JOIN payments p ON p.id = a.refund_payment_id
     WHERE a.refund_request_id = ${op.refundRequestId}::uuid AND p.status <> 'SUCCEEDED'`;
  if (BigInt(remaining[0]?.pending ?? 0n) !== 0n) return 'APPROVED';
  const updated = await tx.$executeRaw`
    UPDATE refund_requests SET status = 'PAID', paid_at = ${now}::timestamptz,
           updated_at = ${now}::timestamptz
     WHERE id = ${op.refundRequestId}::uuid AND status = 'APPROVED'`;
  if (updated === 1) {
    const payload = await paidPayload(tx, op);
    await tx.$executeRaw`
      INSERT INTO outbox_events(event_type, aggregate_type, aggregate_id, payload_json)
      VALUES ('RefundPaid', 'RefundRequest', ${op.refundRequestId}::uuid,
        ${JSON.stringify({
          refundRequestId: op.refundRequestId,
          bookingId,
          amount: payload.amount.toString(),
          legs: payload.legs.map((leg) => ({
            amount: leg.amount.toString(),
            method: leg.method,
            providerTxnId: leg.provider_txn_id,
          })),
        })}::jsonb)`;
  }
  const current = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM refund_requests WHERE id = ${op.refundRequestId}::uuid`;
  return current[0]?.status ?? 'PAID';
}

/** Giữ đúng định nghĩa của `BookingLedger`: tổng allocation có chứng từ chi SUCCEEDED của booking. */
async function syncRefundedAmount(tx: Tx, bookingId: string, now: Date): Promise<void> {
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

async function recordSettled(
  tx: Tx,
  op: ClaimedPayout,
  transfer: TransferEvidence,
  status: string,
  now: Date,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO audit_logs(chain_seq, actor_id, actor_role, action, entity_type, entity_id,
      before_json, after_json, reason, row_hash, at)
    VALUES (0, null, 'SYSTEM', 'REFUND_PAYOUT_SETTLED', 'RefundRequest',
      ${op.refundRequestId}::uuid,
      ${JSON.stringify({ status: 'APPROVED', operationId: op.id, paymentStatus: 'PENDING' })}::jsonb,
      ${JSON.stringify({
        status,
        operationId: op.id,
        refundPaymentId: op.refundPaymentId,
        amount: op.amount.toString(),
        providerTxnId: transfer.providerTxnId,
        method: op.method,
      })}::jsonb,
      'Chi hoàn được PSP xác nhận', 'pending-database-trigger', ${now}::timestamptz)`;
}

export async function settlePayout(
  db: PrismaClient,
  op: ClaimedPayout,
  transfer: TransferEvidence,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const bookingId = await lockForSettlement(tx, op);
    const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
    const paid = await tx.$executeRaw`
      UPDATE payments
         SET status = 'SUCCEEDED', provider_txn_id = ${transfer.providerTxnId},
             paid_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
       WHERE id = ${op.refundPaymentId}::uuid AND status = 'PENDING'`;
    if (paid !== 1) throw new StalePayoutLease();
    const settled = await tx.$executeRaw`
      UPDATE refund_payout_operations
         SET status = 'SUCCEEDED', provider_txn_id = ${transfer.providerTxnId},
             finished_at = ${now}::timestamptz, lease_token = NULL, lease_expires_at = NULL,
             last_error = NULL, updated_at = ${now}::timestamptz
       WHERE id = ${op.id}::uuid AND lease_token = ${op.leaseToken}::uuid AND version = ${op.version}`;
    if (settled !== 1) throw new StalePayoutLease();
    const status = await markPaidIfComplete(tx, op, bookingId, now);
    await syncRefundedAmount(tx, bookingId, now);
    await recordSettled(tx, op, transfer, status, now);
  });
}
