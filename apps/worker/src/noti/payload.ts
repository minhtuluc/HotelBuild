import { z } from 'zod';

/**
 * Dữ liệu job `q.notification-send` — gương của `NotificationJobData` trong
 * `apps/api/src/modules/noti/queue.ts` (worker không dùng chung package với API).
 * Handler kiểm schema này TRƯỚC khi chạm CSDL (hợp đồng file `jobs/types.ts`).
 */
export const notificationSendPayloadSchema = z.strictObject({
  notificationId: z.uuid(),
  // Ngữ cảnh quan sát (HB-181) do API gắn khi đẩy job — không phải dữ liệu nghiệp vụ.
  traceparent: z.string().max(128).optional(),
  correlationId: z.string().max(128).optional(),
});

export type NotificationSendPayload = z.infer<typeof notificationSendPayloadSchema>;
