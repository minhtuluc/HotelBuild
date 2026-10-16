import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Clock } from '@pinehill/domain';
import type { NotificationChannel } from '@pinehill/contracts';
import { notificationMessageSchema } from './message.js';
import type { NotificationMessage } from './message.js';
import type { NotificationQueuePort } from './queue.js';

/**
 * Cổng ra log tối thiểu của gateway: chỉ định danh + mã lỗi, không bao giờ nhận payload/PII
 * (NFR-SEC-03). Người tích hợp cấp bằng pino ở module (xem `module.ts`).
 */
export interface NotificationLog {
  error(entry: { event: string; notificationId: string; errorCode: string }): void;
}

export interface NotificationDispatch {
  readonly bookingId: string | null;
  readonly recipient: string;
  readonly channel: NotificationChannel;
  readonly template: string;
  readonly message: NotificationMessage;
}

/** Mã lỗi ổn định, không chứa nội dung provider (có thể mang PII/bí mật). */
function queueErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'UNKNOWN';
}

/**
 * `payload_json` phải là đối tượng JSON thuần (chuỗi/số/boolean) để Prisma nhận đúng kiểu
 * `InputJsonObject`; schema của hợp đồng đã siết khóa/nội dung trước đó.
 */
const payloadJsonSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

/**
 * Điểm vào dùng chung để luồng nghiệp vụ khác (đặt phòng/huỷ/hoàn/điều chuyển) phát thông báo
 * cho khách **sau khi transaction của mình commit** (UC-NOTI-01/02).
 *
 * Vì HB-130 (outbox relay) chưa có, gateway ghi trực tiếp + phát job trực tiếp sau commit
 * (xem README). Mẫu dùng trong transaction của luồng gọi:
 *
 * ```ts
 * const id = await this.db.$transaction((tx) => gateway.record(tx, dispatch));
 * await gateway.publish(id);
 * ```
 */
export class NotificationGateway {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly queue: NotificationQueuePort,
    readonly log: NotificationLog,
  ) {}

  /** Ghi bản ghi `PENDING` trong transaction của luồng nghiệp vụ (không tự commit). */
  async record(tx: Prisma.TransactionClient, dispatch: NotificationDispatch): Promise<string> {
    const message = notificationMessageSchema.safeParse(dispatch.message);
    if (!message.success) throw new Error('NOTIFICATION_MESSAGE_INVALID');
    const row = await tx.notifications.create({
      data: {
        booking_id: dispatch.bookingId,
        recipient: dispatch.recipient,
        channel: dispatch.channel,
        template: dispatch.template,
        payload_json: payloadJsonSchema.parse(message.data),
        status: 'PENDING',
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Phát job gửi sau khi transaction đã commit (không chặn việc gửi thật — job chạy nền).
   * ADR-004: PostgreSQL là nguồn bền, Redis chỉ tăng tốc, nên lỗi phát job không đảo kết quả đã
   * commit: ghi một dòng lỗi an toàn và giữ bản ghi `PENDING` để relay HB-130 quét lại.
   */
  async publish(notificationId: string): Promise<void> {
    try {
      await this.queue.enqueue(notificationId);
    } catch (error) {
      this.log.error({
        event: 'NOTIFICATION_ENQUEUE_FAILED',
        notificationId,
        errorCode: queueErrorCode(error),
      });
    }
  }

  /** Đường tắt cho luồng chưa tự mở transaction: ghi + phát job. */
  async notify(dispatch: NotificationDispatch): Promise<string> {
    const id = await this.db.$transaction((tx) => this.record(tx, dispatch));
    await this.publish(id);
    return id;
  }
}
