/**
 * Cổng chi hoàn thật của HB-100 dùng lại cho walk-out: worker + PSP mô phỏng chạy trên cùng CSDL
 * tách riêng. Không mock transaction/DB/PSP idempotency — chỉ thay gateway để ép timeout.
 */
import { db, databaseUrl } from '../../idempotency/database.js';
import type { WorkerConfig } from '../../../../worker/src/config/env.js';
import { loadWorkerConfig } from '../../../../worker/src/config/env.js';
import { createRefundPayoutJob } from '../../../../worker/src/jobs/refund-payout/refund-payout.job.js';
import type { JobContext } from '../../../../worker/src/jobs/types.js';
import { clock, rows } from './harness.js';

export { db };

export function jobContext(overrides: Partial<WorkerConfig> = {}): JobContext {
  const config = loadWorkerConfig({
    ...process.env,
    DATABASE_URL: databaseUrl,
    REDIS_URL: process.env.REDIS_URL ?? '',
    LOG_LEVEL: 'silent',
    REFUND_PAYOUT_SIMULATOR: 'true',
  });
  return { db, config: { ...config, ...overrides }, clock, log: () => {} };
}

export const runPayoutJob = (
  deps?: Parameters<typeof createRefundPayoutJob>[0],
  overrides: Partial<WorkerConfig> = {},
) => createRefundPayoutJob(deps)({}, jobContext(overrides));

export const operations = (refundId: string) =>
  rows(
    'SELECT * FROM refund_payout_operations WHERE refund_request_id=$1::uuid ORDER BY created_at',
    [refundId],
  );

export const heldAmount = async (bookingId: string): Promise<string> =>
  String(
    (
      await rows(
        `SELECT coalesce(sum(a.amount),0)::text AS held FROM refund_allocations a
           JOIN refund_requests r ON r.id = a.refund_request_id
          WHERE r.booking_id = $1 AND r.status IN ('PENDING','APPROVED','PAID')`,
        [bookingId],
      )
    )[0]!.held,
  );

export const refundPayments = (bookingId: string) =>
  rows(
    "SELECT id,type,method,amount::text AS amount,status FROM payments WHERE booking_id=$1 AND type='REFUND'",
    [bookingId],
  );

export const simulatorTransfers = () =>
  rows('SELECT * FROM refund_payout_simulator_transfers ORDER BY created_at');

export type { PayoutGateway } from '../../../../worker/src/jobs/refund-payout/types.js';
