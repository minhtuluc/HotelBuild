import { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { redisOptions } from '../../bullmq.factory.js';
import type { JobContext } from '../types.js';
import { CHANNEL_SYNC_FAILED, CHANNEL_SYNC_QUEUE, DEGRADED_AFTER_FAILURES } from './contract.js';
import type { ChannelSyncSettings } from './settings.js';

/** Gương của API (`noti/queue.ts`): cùng tên hàng đợi/job và cùng trần lượt gửi. */
const NOTIFICATION_QUEUE = 'q.notification-send';
const NOTIFICATION_JOB = 'notification-send';
const NOTIFICATION_MAX_ATTEMPTS = 3;
const NOTIFICATION_RESEND_DELAY_MS = 5 * 60 * 1000;

/** Cổng phát job thông báo — bơm được để test không cần BullMQ; URL Redis đến từ `WorkerConfig`. */
export type NotifyPort = (redisUrl: string, notificationId: string) => Promise<void>;

async function bullmqNotify(redisUrl: string, notificationId: string): Promise<void> {
  const queue = new Queue(NOTIFICATION_QUEUE, { connection: redisOptions(redisUrl) });
  queue.on('error', () => undefined);
  try {
    await queue.add(
      NOTIFICATION_JOB,
      { notificationId },
      {
        attempts: NOTIFICATION_MAX_ATTEMPTS,
        backoff: { type: 'fixed', delay: NOTIFICATION_RESEND_DELAY_MS },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 1000 },
      },
    );
  } finally {
    await queue.close();
  }
}

export interface AttemptOutcome {
  /** `false` khi lượt này đã được ghi trước đó (phát lại cùng `key`) — không đếm lỗi lần hai. */
  readonly fresh: boolean;
  readonly notificationId: string | null;
}

interface ChannelRef {
  readonly id: string;
  readonly code: string;
}

/**
 * Ghi một hạt cảnh báo `CHANNEL_DEGRADED`: một `notifications` PENDING cho MANAGER và một `audit_logs`
 * `ALERT_RAISED` (actor SYSTEM) **trong cùng transaction** với cập nhật kênh. Không chứa payload/URL.
 */
async function raiseDegraded(
  tx: Prisma.TransactionClient,
  context: JobContext,
  channel: ChannelRef,
  settings: ChannelSyncSettings,
): Promise<string | null> {
  const reason =
    `Kênh ${channel.code} DEGRADED sau ${DEGRADED_AFTER_FAILURES} lần đồng bộ lỗi liên tiếp ` +
    `(${CHANNEL_SYNC_FAILED})`;
  let notificationId: string | null = null;
  if (settings.managerRecipient !== null) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO notifications(recipient, channel, template, payload_json, status)
      VALUES (${settings.managerRecipient}, 'EMAIL', 'alert-channel-degraded',
              ${JSON.stringify({
                reason,
                channelId: channel.id,
                channelCode: channel.code,
                errorCode: CHANNEL_SYNC_FAILED,
              })}::jsonb, 'PENDING')
      RETURNING id`;
    notificationId = rows[0]?.id ?? null;
  }
  await tx.$executeRaw`
    INSERT INTO audit_logs(
      chain_seq, row_hash, actor_id, actor_role, action, entity_type, entity_id,
      before_json, after_json, reason, at
    ) VALUES (
      0, 'pending-database-trigger', NULL, 'SYSTEM', 'ALERT_RAISED', 'Notification',
      ${notificationId}::uuid, NULL,
      ${JSON.stringify({
        condition: 'CHANNEL_DEGRADED',
        target: 'MANAGER',
        subject: `channel:${channel.id}`,
        channelCode: channel.code,
        detail: reason,
      })}::jsonb,
      ${`Cảnh báo kênh ${channel.code} DEGRADED`}, ${context.clock.now()}
    )`;
  return notificationId;
}

/**
 * Chốt **một lượt đồng bộ** theo khoá idempotent (`attemptKey`), trong **một transaction**:
 *
 * - `channel_sync_attempts` là sổ bền theo `(channel, key)`: phát lại cùng khoá không tăng counter, không
 *   phát cảnh báo lần hai (cùng tinh thần ADR-017).
 * - Thành công đã xác minh: `sync_status = OK`, counter 0, `last_sync_at` mới — **giữ** `last_sync_error`
 *   và lịch sử cảnh báo để vận hành còn bằng chứng (BR-CHAN-07).
 * - Thất bại: counter 1→2→3 (kẹp trần 3); đúng lần thứ ba chuyển `DEGRADED`, ghi mã lỗi đã che và phát
 *   cảnh báo MANAGER đúng một lần.
 */
export async function recordAttempt(
  context: JobContext,
  channel: ChannelRef,
  attemptKey: string,
  succeeded: boolean,
  settings: ChannelSyncSettings,
  operationId: string | null,
): Promise<AttemptOutcome> {
  const outcome = await context.db.$transaction(async (tx) => {
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO channel_sync_attempts(channel_id, attempt_key, outcome, error_code, attempted_at)
      VALUES (${channel.id}::uuid, ${attemptKey}, ${succeeded ? 'SUCCESS' : 'FAILURE'},
              ${succeeded ? null : CHANNEL_SYNC_FAILED}, clock_timestamp())
      ON CONFLICT (channel_id, attempt_key) DO NOTHING
      RETURNING id`;
    if (inserted.length === 0) return { fresh: false, notificationId: null };
    let notificationId: string | null = null;
    if (succeeded) {
      await tx.$executeRaw`
        UPDATE channels
           SET sync_status = 'OK', consecutive_sync_failures = 0,
               last_sync_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE id = ${channel.id}::uuid`;
    } else {
      const updated = await tx.$queryRaw<{ failures: number }[]>`
        UPDATE channels
           SET consecutive_sync_failures =
                 LEAST(${DEGRADED_AFTER_FAILURES}::int, consecutive_sync_failures + 1),
               sync_status = CASE
                 WHEN consecutive_sync_failures + 1 >= ${DEGRADED_AFTER_FAILURES}::int
                 THEN 'DEGRADED' ELSE sync_status END,
               last_sync_error = ${CHANNEL_SYNC_FAILED},
               updated_at = clock_timestamp()
         WHERE id = ${channel.id}::uuid
         RETURNING consecutive_sync_failures AS failures`;
      if (Number(updated[0]?.failures) === DEGRADED_AFTER_FAILURES)
        notificationId = await raiseDegraded(tx, context, channel, settings);
    }
    if (operationId !== null)
      await tx.$executeRaw`
        UPDATE operations
           SET status = ${succeeded ? 'SUCCEEDED' : 'FAILED'},
               error_code = ${succeeded ? null : CHANNEL_SYNC_FAILED},
               finished_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE id = ${operationId}::uuid AND status = 'PENDING'`;
    return { fresh: true, notificationId };
  });
  context.log({
    queue: CHANNEL_SYNC_QUEUE,
    msg:
      `kênh ${channel.code}: ${succeeded ? 'đồng bộ đã xác minh' : 'đồng bộ lỗi'}` +
      (outcome.fresh ? '' : ' (lượt phát lại, bỏ qua)'),
    ...(succeeded ? {} : { errorCode: CHANNEL_SYNC_FAILED }),
  });
  return outcome;
}

/** Phát job gửi thông báo **sau** khi commit; lỗi phát không làm mất cảnh báo bền trong `notifications`. */
export const notifyManager: NotifyPort = bullmqNotify;
