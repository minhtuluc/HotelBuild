import type { OutboxConsumer } from './consumer.js';
import { OUTBOX_CONSUMERS } from './consumers.js';
import { OUTBOX_QUEUE, relayOnce, relayOptionsFromConfig } from './relay.js';
import type { JobHandler } from '../types.js';

/**
 * Handler thật của `q.outbox-relay` (HB-130). Hàng đợi chỉ là **nhịp chạy**: payload job không mang dữ
 * liệu nghiệp vụ (đúng như `exportCleanupJob`), công việc đọc từ PostgreSQL nên mất job trên Redis hay
 * khởi động lại tiến trình đều không mất sự kiện.
 *
 * Handler cố ý **không** ném lỗi consumer ra ngoài: mỗi lượt vận chuyển thất bại đã được ghi bền vào
 * `event_deliveries` (`attempts`, `last_error`, mốc thử lại) — cơ chế thử lại là lượt quét sau, không phải
 * BullMQ. Lỗi hạ tầng (CSDL) vẫn ném ra để lượt chạy bị coi là hỏng và thử lại.
 *
 * `consumers` bơm được để test điều khiển consumer; bản chạy thật dùng {@link OUTBOX_CONSUMERS}.
 */
export function createOutboxRelayJob(consumers: readonly OutboxConsumer[]): JobHandler {
  return async (_data, context) => {
    const report = await relayOnce(context, consumers, relayOptionsFromConfig(context.config));
    context.log({
      queue: OUTBOX_QUEUE,
      msg:
        `relay: đăng ký ${report.registered}, nhận ${report.claimed}, xong ${report.completed}, ` +
        `thử lại ${report.retried}, dead letter ${report.deadLettered}, bỏ qua ${report.stale}, ` +
        `không consumer ${report.unrouted}, sự kiện PUBLISHED ${report.published}, DEAD_LETTER ${report.eventsDeadLettered}`,
    });
  };
}

export const outboxRelayJob: JobHandler = createOutboxRelayJob(OUTBOX_CONSUMERS);
