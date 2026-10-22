/**
 * HB-182 — handler `q.alerts-scan` (NFR-OBS-04, BR-INV-03, BR-CHAN-07, BR-RBAC-06, BR-CANCEL-12).
 *
 * Hàng đợi chỉ là **nhịp chạy**: payload rỗng, mọi thứ đọc từ PostgreSQL nên mất job trên Redis hay khởi
 * động lại tiến trình đều không bỏ sót sự cố (cùng lối `q.hold-expiry`).
 *
 * Một sự cố → đúng **một** cảnh báo mỗi cửa sổ (`dedup.ts`) và một bản ghi `notifications` `PENDING` cho
 * mỗi đích nhận, rồi phát job `q.notification-send` của đường noti hiện có (email qua SMTP/Mailpit ở dev).
 * `notifications` + `audit_logs` (`ALERT_RAISED`, actor SYSTEM) ghi **cùng một transaction**; phát job sau
 * khi commit. Cảnh báo gửi hỏng vẫn để lại vết kiểm toán và hàng `PENDING` cho nhân viên thấy.
 */
import { Queue } from 'bullmq';
import { redisOptions } from '../../bullmq.factory.js';
import { safeErrorCode } from '../hold-expiry/expire.js';
import type { QueueName } from '../../queues.js';
import type { AlertSettings, AlertTarget } from './catalog.js';
import { ALERT_CONDITIONS, dedupKey, loadAlertSettings } from './catalog.js';
import { createAlertDedup } from './dedup.js';
import type { AlertDedupStore } from './dedup.js';
import { collectAlertFindings } from './scan.js';
import type { AlertFinding } from './scan.js';
import type { JobContext, JobHandler } from '../types.js';

const ALERTS_QUEUE: QueueName = 'q.alerts-scan';
/** Gương của `NOTIFICATION_QUEUE_NAME`/`NOTIFICATION_JOB_NAME`/`NOTIFICATION_MAX_ATTEMPTS` bên API. */
const NOTIFICATION_QUEUE = 'q.notification-send';
const NOTIFICATION_JOB = 'notification-send';
const NOTIFICATION_MAX_ATTEMPTS = 3;
const NOTIFICATION_RESEND_DELAY_MS = 5 * 60 * 1000;
const DETAIL_MAX_CHARS = 500;

/** Cổng phát job gửi — bơm được để test không cần BullMQ. */
export interface AlertQueuePort {
  add(notificationId: string): Promise<void>;
  close(): Promise<void>;
}

function bullmqQueue(redisUrl: string): AlertQueuePort {
  const queue = new Queue(NOTIFICATION_QUEUE, { connection: redisOptions(redisUrl) });
  queue.on('error', () => undefined);
  return {
    async add(notificationId) {
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
    },
    async close() {
      await queue.close();
    },
  };
}

/**
 * Ghi hàng `notifications` + vết `ALERT_RAISED` trong một transaction; trả id thông báo để phát job.
 * Nội dung thư nằm trong `payload_json.reason` — đúng khung `notificationMessageSchema` mà worker gửi.
 */
async function recordAlert(
  context: JobContext,
  settings: AlertSettings,
  finding: AlertFinding,
  target: AlertTarget,
): Promise<string> {
  const spec = ALERT_CONDITIONS[finding.condition];
  const recipient = settings.recipient(target);
  const dedupSeconds = settings.dedupSeconds(finding.condition);
  const reason = finding.detail.slice(0, DETAIL_MAX_CHARS);
  return context.db.$transaction(async (tx) => {
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO notifications(recipient, channel, template, payload_json, status)
      VALUES (${recipient}, 'EMAIL', ${spec.template}, ${JSON.stringify({ reason })}::jsonb, 'PENDING')
      RETURNING id`;
    const notificationId = inserted[0]?.id;
    if (notificationId === undefined) throw new Error('ALERT_NOTIFICATION_NOT_CREATED');
    const after = {
      condition: finding.condition,
      target,
      subject: finding.subject,
      propertyId: finding.propertyId,
      detail: reason,
      dedupSeconds,
    };
    await tx.$executeRaw`
      INSERT INTO audit_logs(
        chain_seq, row_hash, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, reason, at
      ) VALUES (
        0, 'pending-database-trigger', NULL, 'SYSTEM', 'ALERT_RAISED', 'Notification',
        ${notificationId}::uuid, NULL, ${JSON.stringify(after)}::jsonb,
        ${`Cảnh báo vận hành ${finding.condition}`}, ${context.clock.now()}
      )`;
    return notificationId;
  });
}

export interface AlertsJobDeps {
  readonly dedup?: (redisUrl: string) => AlertDedupStore;
  readonly queue?: (redisUrl: string) => AlertQueuePort;
}

/** Handler dựng được để test bơm Redis/hàng đợi; export chính `alertsScanJob` dùng kết nối thật. */
export function createAlertsJob(deps: AlertsJobDeps = {}): JobHandler {
  return async (_data, context) => {
    const settings = await loadAlertSettings(context.db);
    const findings = await collectAlertFindings(
      context.db,
      settings,
      context.config.ALERTS_SCAN_BATCH_SIZE,
    );
    if (findings.length === 0) {
      context.log({ queue: ALERTS_QUEUE, msg: 'quét cảnh báo: không có sự cố' });
      return;
    }
    const dedup = (deps.dedup ?? createAlertDedup)(context.config.REDIS_URL);
    const queue = (deps.queue ?? bullmqQueue)(context.config.REDIS_URL);
    let sent = 0;
    let suppressed = 0;
    let failed = 0;
    try {
      for (const finding of findings) {
        const key = dedupKey(finding.condition, finding.subject);
        if (!(await dedup.acquire(key, settings.dedupSeconds(finding.condition)))) {
          suppressed += 1;
          continue;
        }
        try {
          for (const target of ALERT_CONDITIONS[finding.condition].targets) {
            await queue.add(await recordAlert(context, settings, finding, target));
            sent += 1;
          }
        } catch (error) {
          failed += 1;
          await dedup.release(key);
          const errorCode = safeErrorCode(error);
          context.log({
            queue: ALERTS_QUEUE,
            msg: `cảnh báo ${finding.condition} lỗi khi ghi/phát (mã ${errorCode})`,
            errorCode,
          });
        }
      }
    } finally {
      await dedup.close();
      await queue.close();
    }
    context.log({
      queue: ALERTS_QUEUE,
      msg:
        `quét cảnh báo: ${findings.length} sự cố, gửi ${sent} cảnh báo, ` +
        `bỏ qua ${suppressed} trong cửa sổ chống trùng, ${failed} lỗi`,
    });
  };
}

export const alertsScanJob: JobHandler = createAlertsJob();
