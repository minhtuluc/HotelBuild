import type { OnApplicationShutdown, Provider } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { NOTIFICATION_MAX_RESENDS } from '@pinehill/contracts';
import { CONFIG } from '../../config/env.js';
import type { ApiConfig } from '../../config/env.js';

/**
 * Cổng ra hàng đợi gửi thông báo. BullMQ giữ `attempts` + `backoff` nên khoảng cách 5 phút giữa
 * hai lượt thử do hàng đợi đảm bảo, còn máy chủ ghi nhận từng lượt vào `notifications`
 * (BR-SYS-06, xem `apps/worker/src/noti/send.job.ts`).
 */

export const NOTIFICATION_QUEUE = Symbol('NOTIFICATION_QUEUE');
export const NOTIFICATION_QUEUE_NAME = 'q.notification-send';
export const NOTIFICATION_JOB_NAME = 'notification-send';

/**
 * Số lượt BullMQ chạy một job = số lượt gửi thật: **lần gửi đầu + 2 lượt gửi lại** = `NOTIFICATION_MAX_RESENDS`.
 * Worker đánh `FAILED` ngay ở lượt mà số lần gửi thất bại chạm `retry_count = 3` rồi ném lỗi để kết thúc
 * job, nên `+ 1` chỉ hẹn thêm một lượt vô ích (lượt đó gặp hàng `FAILED` và thoát mà không gửi gì) —
 * xem `apps/worker/src/noti/send.job.ts`. `retry_count` vẫn là số lượt gửi tự động đã thất bại trong chu
 * kỳ hiện tại; không đổi ngữ nghĩa.
 */
export const NOTIFICATION_MAX_ATTEMPTS = NOTIFICATION_MAX_RESENDS;
/** Khoảng cách tối thiểu giữa hai lượt gửi (BR-SYS-06). */
export const NOTIFICATION_RESEND_DELAY_MS = 5 * 60 * 1000;

/** Dữ liệu job gửi thông báo — gương với `apps/worker/src/noti/payload.ts` (không dùng chung được). */
export interface NotificationJobData {
  readonly notificationId: string;
}

export interface NotificationQueuePort {
  enqueue(notificationId: string): Promise<void>;
}

/** `REDIS_URL` → tuỳ chọn kết nối, cùng cách `apps/worker/src/bullmq.factory.ts` làm. */
export function notificationQueueConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    db,
    ...(parsed.username ? { username: parsed.username } : {}),
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

export class BullNotificationQueue implements NotificationQueuePort, OnApplicationShutdown {
  constructor(readonly queue: Queue) {
    // Lỗi kết nối nền không gây sập tiến trình; lỗi của từng lệnh phát báo ở chỗ gọi `enqueue`.
    this.queue.on('error', () => undefined);
  }

  async enqueue(notificationId: string): Promise<void> {
    const data: NotificationJobData = { notificationId };
    await this.queue.add(NOTIFICATION_JOB_NAME, data, {
      attempts: NOTIFICATION_MAX_ATTEMPTS,
      backoff: { type: 'fixed', delay: NOTIFICATION_RESEND_DELAY_MS },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 1000 },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

export const notificationQueueProvider: Provider = {
  provide: NOTIFICATION_QUEUE,
  inject: [CONFIG],
  useFactory: (config: ApiConfig): NotificationQueuePort =>
    new BullNotificationQueue(
      new Queue(NOTIFICATION_QUEUE_NAME, {
        connection: notificationQueueConnection(config.REDIS_URL),
      }),
    ),
};
