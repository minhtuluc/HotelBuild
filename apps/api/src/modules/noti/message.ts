import { z } from 'zod';

/**
 * Nội dung thông báo (`notifications.payload_json`) mà luồng nghiệp vụ điền cho khách.
 *
 * Gương của `apps/worker/src/noti/message.ts` (worker không import được `apps/api` nên không dùng
 * chung được): hai bên đều `strictObject`, khóa lạ bị từ chối ở lúc ghi thay vì lọt thành
 * nội dung email/SMS gửi khách. Sửa một bên thì phải sửa bên kia.
 */
export const notificationMessageSchema = z.strictObject({
  guestName: z.string().min(1).max(120).optional(),
  bookingCode: z.string().min(1).max(40).optional(),
  checkIn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD')
    .optional(),
  checkOut: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD')
    .optional(),
  amountVnd: z.number().int().min(0).optional(),
  reason: z.string().min(1).max(500).optional(),
});

export type NotificationMessage = z.infer<typeof notificationMessageSchema>;
