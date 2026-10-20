/** Nhận việc chi hoàn bằng lease + SKIP LOCKED (HB-100; ADR-016, ADR-014). */
import type { PrismaClient } from '@prisma/client';
import type { ClaimedPayout } from './types.js';

/**
 * Một câu `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED)`:
 * - chỉ nhặt `READY`/`UNKNOWN`/`IN_FLIGHT` khi lease đã hết (crash, timeout, lần chờ đối soát trước);
 * - cấp `lease_token` **mới** và đẩy `version` (trigger) để worker cũ không commit được nữa;
 * - hai worker chạy đồng thời không nhận cùng một dòng.
 */
export async function claimPayouts(
  db: PrismaClient,
  limit: number,
  leaseSeconds: number,
  operationId?: string,
): Promise<ClaimedPayout[]> {
  return db.$queryRaw<ClaimedPayout[]>`
    WITH candidate AS (
      SELECT id FROM refund_payout_operations
       WHERE status IN ('READY','IN_FLIGHT','UNKNOWN')
         AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
         AND (${operationId ?? null}::uuid IS NULL OR id = ${operationId ?? null}::uuid)
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT ${limit}
    )
    UPDATE refund_payout_operations o
       SET status = 'IN_FLIGHT',
           lease_token = gen_random_uuid(),
           lease_expires_at = clock_timestamp() + make_interval(secs => ${leaseSeconds}::int),
           updated_at = clock_timestamp()
      FROM candidate c
     WHERE o.id = c.id
    RETURNING o.id AS "id", o.refund_request_id AS "refundRequestId",
      o.refund_allocation_id AS "refundAllocationId",
      o.original_payment_id AS "originalPaymentId", o.refund_payment_id AS "refundPaymentId",
      o.method AS "method", o.amount AS "amount", o.bank_note AS "bankNote",
      o.psp_key AS "pspKey", o.attempts AS "attempts", o.lease_token AS "leaseToken",
      o.version AS "version"`;
}
