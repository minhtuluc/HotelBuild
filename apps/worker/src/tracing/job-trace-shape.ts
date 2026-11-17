import { z } from 'zod';

/**
 * Khoá quan sát (HB-181) mà producer ở API gắn vào **dữ liệu job BullMQ** khi đẩy việc
 * (`noti/queue.ts`, `rep/export/queue.ts`): không phải dữ liệu nghiệp vụ, chỉ để nối trace.
 *
 * Schema payload job dùng `z.strictObject` nên khoá lạ bị từ chối; mọi job **do API đẩy** phải trải
 * shape này vào schema của mình (TD-32), thay vì tự khai lại từng khoá — job nhịp lặp do worker tự đăng ký
 * không mang trace nên không cần.
 */
export const jobTraceShape = {
  traceparent: z.string().max(128).optional(),
  correlationId: z.string().max(128).optional(),
} as const;
