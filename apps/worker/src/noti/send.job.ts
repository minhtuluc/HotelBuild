import type { Prisma } from '@prisma/client';
import { NOTIFICATION_MAX_RESENDS } from '@pinehill/contracts';
import { ChannelDeliveryError, type ChannelSenders } from './channels.js';
import { NOTIFICATION_CHANNELS, parseOutgoingMessage } from './message.js';
import { notificationSendPayloadSchema } from './payload.js';
import type { JobContext, JobHandler } from '../jobs/types.js';

/** Handler thật do `jobs/registry.ts` dựng từ `WorkerConfig` (cấu hình SMTP đi vào qua tham số). */

/**
 * HB-168 — gửi một thông báo qua kênh của nó rồi đóng dấu kết quả vào `notifications`.
 *
 * - **Giành hàng nguyên tử**: cả lượt gửi nằm trong một transaction giữ `SELECT … FOR UPDATE` trên hàng
 *   thông báo, nên hai job cùng một `notificationId` (lượt BullMQ thử lại chồng với thao tác "gửi lại" của
 *   nhân viên) chạy **nối tiếp**: lượt sau chờ khoá rồi đọc thấy `SENT`/`FAILED` của lượt trước nên thoát.
 * - Đã `SENT`/`FAILED`/`CANCELLED` ⇒ không gửi lần hai (idempotent, kể cả job phát lại).
 * - Ba lần thất bại ⇒ `retry_count` chạm trần `NOTIFICATION_MAX_RESENDS` (3), `status = FAILED`,
 *   `error_message` là mã ổn định (không PII, không chi tiết mạng), và một bản ghi kiểm toán
 *   `NOTIFICATION_DELIVERY_FAILED` làm **cờ cảnh báo** cho nhân viên (đọc bằng
 *   `GET /audit-logs`, vai trò MANAGER/OWNER).
 * - Lỗi gửi được **ghi nhận rồi mới ném lại** (transaction phải commit phần `retry_count`/`FAILED` mới có
 *   ý nghĩa) để BullMQ thử tiếp; số lượt và khoảng cách 5 phút do API đặt lúc phát job
 *   (`apps/api/src/modules/noti/queue.ts`), nên trần `NOTIFICATION_MAX_RESENDS` ở đây phải khớp số lượt đó.
 * - Log chỉ mang id/mã lỗi, không bao giờ log địa chỉ nhận/nội dung (NFR-SEC-04).
 */
const ESCALATION_ACTION = 'NOTIFICATION_DELIVERY_FAILED';

/**
 * Trần thời gian một lượt gửi được giữ khoá hàng. Lượt gọi kênh nằm **trong** transaction nên phải rộng
 * hơn mặc định 5 giây của Prisma cho một lần gọi qua mạng; quá hạn thì transaction huỷ, không ghi gì và
 * hàng đợi thử lại ở lượt sau.
 */
const SEND_TRANSACTION_TIMEOUT_MS = 60_000;

interface NotificationRow {
  readonly booking_id: string | null;
  readonly recipient: string;
  readonly channel: string;
  readonly template: string;
  readonly payload_json: unknown;
  readonly status: string;
  readonly sent_at: Date | null;
  readonly retry_count: number;
  readonly error_message: string | null;
}

/** Lỗi gửi đã được ghi vào hàng trong transaction; ném lại sau khi commit để hàng đợi thử lượt sau. */
interface SendFailure {
  readonly error: unknown;
}

/** Đủ dữ liệu cho một bản ghi cảnh báo `NOTIFICATION_DELIVERY_FAILED` trong `audit_logs`. */
interface Escalation {
  readonly notificationId: string;
  readonly channel: string;
  readonly template: string;
  readonly beforeStatus: string;
  readonly beforeRetryCount: number;
  readonly retryCount: number;
  readonly errorMessage: string;
}

function errorMessageOf(error: unknown): string {
  if (error instanceof ChannelDeliveryError) return `Kênh gửi thất bại (${error.code}).`;
  return 'Kênh gửi thất bại.';
}

async function escalate(
  tx: Prisma.TransactionClient,
  context: JobContext,
  escalation: Escalation,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO audit_logs(
      chain_seq, row_hash, actor_id, actor_role, action, entity_type, entity_id,
      before_json, after_json, reason, at
    ) VALUES (
      0, 'pending-database-trigger', NULL, 'SYSTEM', ${ESCALATION_ACTION}, 'Notification',
      ${escalation.notificationId}::uuid,
      ${JSON.stringify({ status: escalation.beforeStatus, retryCount: escalation.beforeRetryCount })}::jsonb,
      ${JSON.stringify({ status: 'FAILED', retryCount: escalation.retryCount, channel: escalation.channel, template: escalation.template, errorMessage: escalation.errorMessage })}::jsonb,
      'Hết lượt gửi lại theo BR-SYS-06', ${context.clock.now()}
    )`;
}

async function markFailed(
  tx: Prisma.TransactionClient,
  notificationId: string,
  retryCount: number,
  errorMessage: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE notifications
       SET status = 'FAILED', retry_count = ${retryCount}, error_message = ${errorMessage}
     WHERE id = ${notificationId}::uuid`;
}

async function markRetrying(
  tx: Prisma.TransactionClient,
  notificationId: string,
  retryCount: number,
  errorMessage: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE notifications
       SET status = 'PENDING', retry_count = ${retryCount}, error_message = ${errorMessage}
     WHERE id = ${notificationId}::uuid`;
}

async function markSent(
  tx: Prisma.TransactionClient,
  notificationId: string,
  sentAt: Date,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE notifications
       SET status = 'SENT', sent_at = ${sentAt}, error_message = NULL
     WHERE id = ${notificationId}::uuid`;
}

/**
 * Một lượt gửi đã giữ khoá hàng: đọc trạng thái mới nhất, gửi nếu còn gửi được, ghi kết quả, rồi trả lỗi
 * (nếu có) cho nơi gọi ném lại **sau khi commit**.
 */
async function runAttempt(
  tx: Prisma.TransactionClient,
  context: JobContext,
  senders: ChannelSenders,
  notificationId: string,
): Promise<SendFailure | null> {
  const rows = await tx.$queryRaw<NotificationRow[]>`
    SELECT booking_id, recipient, channel, template, payload_json, status,
           sent_at, retry_count, error_message
      FROM notifications WHERE id = ${notificationId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) {
    context.log({ queue: 'q.notification-send', msg: 'thông báo không còn tồn tại' });
    return null;
  }
  if (row.status === 'SENT' || row.status === 'FAILED' || row.status === 'CANCELLED') {
    context.log({
      queue: 'q.notification-send',
      msg: `không gửi lại (trạng thái ${row.status})`,
    });
    return null;
  }
  const channel = NOTIFICATION_CHANNELS.find((name) => name === row.channel);
  if (channel === undefined) throw new Error('NOTIFICATION_CHANNEL_UNKNOWN');
  if (row.retry_count >= NOTIFICATION_MAX_RESENDS) {
    const message = 'Hết lượt gửi lại theo BR-SYS-06.';
    await markFailed(tx, notificationId, NOTIFICATION_MAX_RESENDS, message);
    await escalate(tx, context, {
      notificationId,
      channel,
      template: row.template,
      beforeStatus: row.status,
      beforeRetryCount: row.retry_count,
      retryCount: NOTIFICATION_MAX_RESENDS,
      errorMessage: message,
    });
    return null;
  }
  const outgoing = parseOutgoingMessage(channel, row.recipient, row.template, row.payload_json);
  try {
    await senders[channel].send(outgoing);
  } catch (error) {
    const retryCount = row.retry_count + 1;
    const message = errorMessageOf(error);
    if (retryCount >= NOTIFICATION_MAX_RESENDS) {
      await markFailed(tx, notificationId, retryCount, message);
      await escalate(tx, context, {
        notificationId,
        channel,
        template: row.template,
        beforeStatus: row.status,
        beforeRetryCount: row.retry_count,
        retryCount,
        errorMessage: message,
      });
    } else {
      await markRetrying(tx, notificationId, retryCount, message);
    }
    return { error };
  }
  await markSent(tx, notificationId, context.clock.now());
  context.log({ queue: 'q.notification-send', msg: `đã gửi kênh ${channel}` });
  return null;
}

/** Handler dựng được để test bơm bộ gửi giả; export chính `notificationSendJob` dùng bộ thật. */
export function createNotificationSendJob(senders: ChannelSenders): JobHandler {
  return async (data, context) => {
    const parsed = notificationSendPayloadSchema.safeParse(data);
    if (!parsed.success) throw new Error('NOTIFICATION_PAYLOAD_INVALID');
    const { notificationId } = parsed.data;
    // Khoá hàng được giữ suốt lượt gửi: lượt gọi thứ hai phải chờ, sau đó thấy kết quả của lượt trước.
    const failure = await context.db.$transaction(
      (tx) => runAttempt(tx, context, senders, notificationId),
      { timeout: SEND_TRANSACTION_TIMEOUT_MS },
    );
    if (failure !== null) throw failure.error;
  };
}
