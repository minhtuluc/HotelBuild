import type { Prisma } from '@prisma/client';
import {
  notificationChannelSchema,
  notificationStatusSchema,
  type NotificationSummary,
} from '@pinehill/contracts';
import { maskRecipient } from './mask.js';

/** Chỉ trường an toàn của một thông báo: không bao giờ select `recipient` thô để trả khách. */
export const notificationSelect = {
  id: true,
  booking_id: true,
  channel: true,
  template: true,
  status: true,
  recipient: true,
  retry_count: true,
  error_message: true,
  sent_at: true,
  created_at: true,
} as const satisfies Prisma.notificationsSelect;

/** Dựng `NotificationSummary` (HB-160): enum phân tích chặt, `recipient` do **máy chủ** che. */
export function project(
  row: Prisma.notificationsGetPayload<{ select: typeof notificationSelect }>,
): NotificationSummary {
  return {
    id: row.id,
    bookingId: row.booking_id,
    channel: notificationChannelSchema.parse(row.channel),
    template: row.template,
    status: notificationStatusSchema.parse(row.status),
    recipientMasked: maskRecipient(row.recipient),
    retryCount: row.retry_count,
    errorMessage: row.error_message,
    sentAt: row.sent_at === null ? null : row.sent_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}
