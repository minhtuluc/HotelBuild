/**
 * Schema phản hồi CHAN của test khoá HB-131 (giai đoạn A). Dùng `.parse` thay vì truy cập `any` của
 * supertest, và cố ý **strict** ở các DTO hợp đồng để trường lạ bị phát hiện.
 *
 * Nguồn: HB-120 (operationRef, sales-closure view, sync-status, outbox-delivery, ota bookings list).
 */
import { z } from 'zod';
import { errorBodySchema, listResponseSchema, operationRefSchema } from '@pinehill/contracts';

export { errorBodySchema, operationRefSchema };

/** `POST /channels/{id}/sync` — đúng ba trường, không kèm dữ liệu vận hành khác. */
export const strictOperationRefSchema = z.strictObject({
  operationId: z.uuid(),
  status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']),
  statusUrl: z.string().min(1),
});

export const closureEntrySchema = z.object({
  closed: z.boolean(),
  reason: z.string().nullable(),
  closedAt: z.string().nullable(),
  reopenedAt: z.string().nullable(),
});

export const closureViewSchema = z.object({
  channelId: z.uuid(),
  rows: z.array(
    z.object({
      roomTypeId: z.uuid(),
      date: z.string(),
      closed: z.boolean(),
      manual: closureEntrySchema,
      automatic: closureEntrySchema,
    }),
  ),
});

export const syncStatusViewSchema = z.object({
  channelId: z.uuid(),
  syncStatus: z.enum(['OK', 'DEGRADED']),
  consecutiveFailures: z.number().int().min(0),
  lastSyncAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastVerifiedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  history: z.array(
    z.object({
      at: z.string(),
      outcome: z.enum(['SUCCESS', 'FAILURE']),
      error: z.string().nullable(),
    }),
  ),
});

export const outboxDeliverySchema = z.object({
  id: z.string().min(1),
  eventId: z.uuid(),
  eventType: z.string().min(1),
  consumerKey: z.string().min(1),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'DEAD_LETTER']),
  attempts: z.number().int().min(0),
  lastError: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
});

export const outboxDeliveryListSchema = listResponseSchema(outboxDeliverySchema);

export const otaBookingRowSchema = z.looseObject({
  id: z.uuid(),
  status: z.string().min(1),
  duplicateSuspected: z.boolean(),
});

export const otaBookingListSchema = listResponseSchema(otaBookingRowSchema);

export const availabilityViewSchema = z.object({
  data: z.array(z.looseObject({ availableCount: z.number().int().min(0) })),
});
