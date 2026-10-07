/**
 * Hợp đồng NOTI — thông báo đã gửi (api.md §2.11); HB-160.
 * Mọi thông báo gửi khách phải được ghi lại kèm trạng thái và số lần thử (BR-SYS-06); gửi lại tối đa
 * **3 lần cách nhau 5 phút**. Danh sách che thông tin người nhận (không lộ SĐT/email đầy đủ).
 */
import { z } from 'zod';
import { isoUtcTimestampSchema, listQuerySchema } from './common.js';
import { notificationChannelSchema, notificationStatusSchema } from './enums.js';

export const notificationQuerySchema = listQuerySchema.extend({
  bookingId: z.string().min(1).optional(),
  channel: notificationChannelSchema.optional(),
  status: notificationStatusSchema.optional(),
  template: z.string().min(1).optional(),
});

/** Một thông báo đã ghi; `recipientMasked` do **máy chủ** che, client không tự che. */
export const notificationSummarySchema = z.object({
  id: z.string().min(1),
  bookingId: z.string().min(1).nullable(),
  channel: notificationChannelSchema,
  template: z.string().min(1),
  status: notificationStatusSchema,
  recipientMasked: z.string().min(1),
  retryCount: z.number().int().min(0),
  /** Sau 3 lần thất bại: `FAILED` kèm cảnh báo (BR-SYS-06). */
  errorMessage: z.string().min(1).nullable(),
  sentAt: isoUtcTimestampSchema.nullable(),
  createdAt: isoUtcTimestampSchema,
});

/** `POST /notifications/{notificationId}/resend` — lý do bắt buộc; quá 3 lần ⇒ từ chối ở máy chủ. */
export const notificationResendRequestSchema = z.strictObject({
  reason: z.string().min(1).max(500),
});

/** Số lần gửi lại tối đa theo BR-SYS-06 (máy chủ vẫn là nơi chặn). */
export const NOTIFICATION_MAX_RESENDS = 3;

export type NotificationSummary = z.infer<typeof notificationSummarySchema>;
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type NotificationResendRequest = z.infer<typeof notificationResendRequestSchema>;
