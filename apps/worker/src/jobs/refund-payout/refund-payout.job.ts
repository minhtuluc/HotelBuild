/**
 * Handler `q.refund-payout` (HB-100; ADR-016, ADR-017).
 *
 * Hàng đợi chỉ là **nhịp chạy**: công việc đọc từ `refund_payout_operations` nên mất job/Redis hay khởi
 * động lại không làm mất khoản chi. Mỗi dòng được claim bằng lease/`SKIP LOCKED`, rồi:
 * 1. **Đối soát trước mọi lần thử lại** (`attempts > 0`) bằng đúng `psp_key` bền; PSP đã chi ⇒ chốt
 *    SUCCEEDED, không gửi lần hai; PSP trả FAILED ⇒ chỉ khi đó mới dùng khoá mới.
 * 2. Timeout/kết quả không rõ ⇒ `UNKNOWN`, giữ hạn mức và hồ sơ APPROVED, hẹn lượt đối soát sau với
 *    **cùng khoá**.
 * 3. Provider không hỗ trợ chi tự động (chuyển khoản tay, cổng chưa cấu hình) ⇒ `UNKNOWN` chờ đối soát
 *    tay; không tự gửi lại (ADR-016: "không tự gửi lại").
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { WorkerConfig } from '../../config/env.js';
import { claimPayouts } from './claim.js';
import { payoutGatewayFor } from './psp.js';
import { settlePayout, StalePayoutLease } from './settle.js';
import { failPayout, parkPayout, startAttempt } from './state.js';
import type { JobHandler } from '../types.js';
import type { ClaimedPayout, PayoutGateway, TransferResult } from './types.js';

export const REFUND_PAYOUT_QUEUE = 'q.refund-payout';
export const STALE_LEASE_CODE = 'STALE_LEASE';
export const PAYOUT_FAILED_CODE = 'REFUND_PAYOUT_FAILED';

export const refundPayoutPayloadSchema = z.strictObject({
  /** Chạy đúng một operation (đẩy tay sau đối soát); vắng ⇒ quét lô như nhịp lặp. */
  operationId: z.uuid().optional(),
});

export interface RefundPayoutDeps {
  /** Bơm cổng PSP để test lỗi mạng; mặc định chọn theo phương thức + cấu hình tiến trình. */
  readonly gateway?: (db: PrismaClient, config: WorkerConfig, method: string) => PayoutGateway;
}

function safeCode(error: unknown): string {
  return error instanceof StalePayoutLease ? STALE_LEASE_CODE : PAYOUT_FAILED_CODE;
}

/** `RESUBMIT` chỉ khi PSP chưa từng thấy khoá (NOT_FOUND): mọi kết quả khác đã được xử lý tại chỗ. */
async function reconcile(
  op: ClaimedPayout,
  gateway: PayoutGateway,
  context: { db: PrismaClient; config: WorkerConfig },
): Promise<'SETTLED' | 'PARKED' | 'RESUBMIT'> {
  if (op.attempts === 0) return 'RESUBMIT';
  const known = await gateway.query(op.pspKey);
  if (known.state === 'SUCCEEDED') {
    await settlePayout(context.db, op, known);
    return 'SETTLED';
  }
  if (known.state === 'FAILED') {
    await failPayout(
      context.db,
      op,
      'PROVIDER_DECLINED',
      context.config.REFUND_PAYOUT_MAX_ATTEMPTS,
    );
    return 'PARKED';
  }
  if (known.state === 'UNKNOWN') {
    await parkPayout(
      context.db,
      op,
      'PROVIDER_UNAVAILABLE',
      context.config.REFUND_PAYOUT_RETRY_SECONDS,
    );
    return 'PARKED';
  }
  return 'RESUBMIT';
}

async function executePayout(
  op: ClaimedPayout,
  gateway: PayoutGateway,
  context: { db: PrismaClient; config: WorkerConfig },
): Promise<'SETTLED' | 'PARKED'> {
  if (!gateway.automatic) {
    await parkPayout(
      context.db,
      op,
      gateway.blockedCode ?? 'MANUAL_RECONCILIATION',
      context.config.REFUND_PAYOUT_MANUAL_POLL_SECONDS,
    );
    return 'PARKED';
  }
  // BẮT BUỘC trước khi thử lại: hỏi PSP theo khoá bền, không gửi mù.
  const known = await reconcile(op, gateway, context);
  if (known !== 'RESUBMIT') return known;
  const started = await startAttempt(context.db, op);
  if (started === null) return 'PARKED';
  const attempt: ClaimedPayout = { ...op, attempts: started.attempts, version: started.version };
  let result: TransferResult;
  try {
    result = await gateway.submit({
      pspKey: attempt.pspKey,
      method: attempt.method,
      amount: attempt.amount,
    });
  } catch {
    // Mất kết nối/không phản hồi: kết quả không rõ, giữ nguyên khoá và hạn mức.
    await parkPayout(
      context.db,
      attempt,
      'PROVIDER_TIMEOUT',
      context.config.REFUND_PAYOUT_RETRY_SECONDS,
    );
    return 'PARKED';
  }
  if (result.state === 'SUCCEEDED') {
    await settlePayout(context.db, attempt, result);
    return 'SETTLED';
  }
  if (result.state === 'FAILED') {
    await failPayout(
      context.db,
      attempt,
      'PROVIDER_DECLINED',
      context.config.REFUND_PAYOUT_MAX_ATTEMPTS,
    );
    return 'PARKED';
  }
  await parkPayout(
    context.db,
    attempt,
    'PROVIDER_TIMEOUT',
    context.config.REFUND_PAYOUT_RETRY_SECONDS,
  );
  return 'PARKED';
}

export function createRefundPayoutJob(deps: RefundPayoutDeps = {}): JobHandler {
  const gatewayFor = deps.gateway ?? payoutGatewayFor;
  return async (data, context) => {
    const payload = refundPayoutPayloadSchema.safeParse(data);
    // Payload sai là lỗi lập trình của bên phát job — mã ổn định, không kèm nội dung (NFR-SEC-04).
    if (!payload.success) throw new Error('REFUND_PAYOUT_PAYLOAD_INVALID');
    const claimed = await claimPayouts(
      context.db,
      context.config.REFUND_PAYOUT_BATCH_SIZE,
      context.config.REFUND_PAYOUT_LEASE_SECONDS,
      payload.data.operationId,
    );
    let settled = 0,
      parked = 0,
      failed = 0;
    for (const op of claimed) {
      try {
        const outcome = await executePayout(
          op,
          gatewayFor(context.db, context.config, op.method),
          context,
        );
        if (outcome === 'SETTLED') settled++;
        else parked++;
      } catch (error) {
        failed++;
        context.log({
          queue: REFUND_PAYOUT_QUEUE,
          msg: 'chi hoàn lỗi; lease giữ tới hết hạn rồi lượt sau đối soát lại',
          errorCode: safeCode(error),
        });
      }
    }
    context.log({
      queue: REFUND_PAYOUT_QUEUE,
      msg: `chi hoàn: nhận ${claimed.length}, chốt ${settled}, chờ đối soát ${parked}, lỗi ${failed}`,
    });
    if (failed > 0) throw new Error(PAYOUT_FAILED_CODE);
  };
}

export const refundPayoutJob: JobHandler = createRefundPayoutJob();
