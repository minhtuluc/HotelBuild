import { z } from 'zod';
import { jobTraceShape } from '../tracing/job-trace-shape.js';

/**
 * Dữ liệu job `q.notification-send` — gương của `NotificationJobData` trong
 * `apps/api/src/modules/noti/queue.ts` (worker không dùng chung package với API).
 * Handler kiểm schema này TRƯỚC khi chạm CSDL (hợp đồng file `jobs/types.ts`).
 */
export const notificationSendPayloadSchema = z.strictObject({
  notificationId: z.uuid(),
  ...jobTraceShape,
});

export type NotificationSendPayload = z.infer<typeof notificationSendPayloadSchema>;
