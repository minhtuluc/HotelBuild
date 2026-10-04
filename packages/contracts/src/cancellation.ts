/**
 * Hợp đồng huỷ & đổi ngày — api.md §2.5, §3.3; csdl §3 (price_snapshots, refund_requests).
 * Cơ sở tính hoàn là `paidAmount`, làm tròn **xuống** 1.000 VND (BR-CANCEL-04,05,11).
 */
import { z } from 'zod';
import { businessDateSchema, isoUtcTimestampSchema } from './common.js';
import { bookingStatusSchema, cancelReasonSchema, refundStatusSchema } from './enums.js';

const percent = z.number().int().min(0).max(100);

/** `POST /bookings/{bookingId}/cancel-preview` — xem trước tiền hoàn, không đổi trạng thái (§3.3). */
export const cancelPreviewRequestSchema = z.strictObject({
  reason: cancelReasonSchema,
  isForceMajeure: z.boolean(),
});

/** Bậc chính sách đã áp cho yêu cầu huỷ (§3.3 khối `cancellation`). */
export const cancellationBreakdownSchema = z.object({
  policyId: z.string().min(1),
  appliedTierId: z.string().min(1),
  hoursBeforeCheckIn: z.number(),
  refundPercent: percent,
  paidAmount: z.number().int().min(0),
  requestedAmount: z.number().int().min(0),
  penaltyAmount: z.number().int().min(0),
  refundFee: z.number().int().min(0),
});

export const cancelPreviewSchema = z.object({
  bookingId: z.string().min(1),
  currency: z.literal('VND'),
  cancellation: cancellationBreakdownSchema,
  warnings: z.array(z.string()).optional(),
});

/** `POST /bookings/{bookingId}/cancel` — toàn phần hoặc một phần theo `bookingRoomIds[]` (§3.3). */
export const cancelRequestSchema = z.strictObject({
  reason: cancelReasonSchema,
  note: z.string().max(500).optional(),
  isForceMajeure: z.boolean(),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  bookingRoomIds: z.array(z.string().min(1)).optional(),
});

export const cancelResponseSchema = z.object({
  bookingId: z.string().min(1),
  status: bookingStatusSchema,
  cancelledAt: isoUtcTimestampSchema,
  cancelReason: cancelReasonSchema,
  releasedAssignmentCount: z.number().int().min(0),
  cancellation: cancellationBreakdownSchema,
  refundRequest: z
    .object({
      id: z.string().min(1),
      status: refundStatusSchema,
      approvedAmount: z.number().int().min(0).nullable(),
    })
    .nullable(),
});

/** `POST /bookings/{bookingId}/reschedule` — không đổi trạng thái, giữ snapshot cũ (BR-BOOK-12,13). */
export const rescheduleRequestSchema = z.strictObject({
  checkIn: businessDateSchema,
  checkOut: businessDateSchema,
  reason: z.string().min(1).max(500).optional(),
  /** Báo giá mới đã chấp nhận cho kỳ mới (§6.4); thiếu thì máy chủ tính lại. */
  quoteId: z.string().min(1).optional(),
});

/** `DELETE /bookings/{bookingId}` — chỉ DRAFT/HELD chưa phát sinh thanh toán, kèm lý do (§2.5). */
export const bookingDeleteQuerySchema = z.strictObject({
  reason: z.string().min(1).max(500),
});

export type CancelPreview = z.infer<typeof cancelPreviewSchema>;
export type CancelPreviewRequest = z.infer<typeof cancelPreviewRequestSchema>;
export type CancelRequest = z.infer<typeof cancelRequestSchema>;
export type CancelResponse = z.infer<typeof cancelResponseSchema>;
export type RescheduleRequest = z.infer<typeof rescheduleRequestSchema>;
