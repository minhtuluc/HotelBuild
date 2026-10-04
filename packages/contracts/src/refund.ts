/** Hợp đồng hoàn tiền — api.md §2.6, §3.6, §3.7; csdl §3 (refund_requests, refund_tiers). */
import { z } from 'zod';
import { isoUtcTimestampSchema, listQuerySchema } from './common.js';
import { cancelReasonSchema, paymentMethodSchema, refundStatusSchema } from './enums.js';

const percent = z.number().int().min(0).max(100);

/** `POST /refund-requests` — bất khả kháng chỉ MANAGER/OWNER và `note` ≥ 20 ký tự (BR-CANCEL-13). */
export const refundRequestCreateRequestSchema = z.strictObject({
  bookingId: z.string().min(1),
  paymentId: z.string().min(1),
  reason: cancelReasonSchema,
  isForceMajeure: z.boolean(),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  note: z.string().max(500).optional(),
});

/** Phản hồi hồ sơ hoàn (§3.6); trường lạ bỏ qua để client cũ đọc được server mới. */
export const refundRequestSchema = z.object({
  id: z.string().min(1),
  bookingId: z.string().min(1),
  paymentId: z.string().min(1),
  policyId: z.string().min(1),
  hoursBeforeCheckIn: z.number(),
  appliedTierId: z.string().min(1),
  refundPercent: percent,
  requestedAmount: z.number().int().min(0),
  approvedAmount: z.number().int().min(0).nullable(),
  refundFee: z.number().int().min(0),
  status: refundStatusSchema,
  isForceMajeure: z.boolean(),
  reason: cancelReasonSchema,
  evidenceRefs: z.array(z.string().min(1)),
  requestedBy: z.string().min(1),
  approvedBy: z.string().min(1).nullable(),
  decidedAt: isoUtcTimestampSchema.nullable(),
  paidAt: isoUtcTimestampSchema.nullable(),
  createdAt: isoUtcTimestampSchema,
});

/** 🔒 Duyệt hoàn: `approvedAmount ≤ requestedAmount`, cấm tự duyệt (BR-CANCEL-15). */
export const refundApproveRequestSchema = z.strictObject({
  approvedAmount: z.number().int().positive(),
  note: z.string().max(500).optional(),
  pinToken: z.string().min(16).optional(),
});

/** 🔒 Từ chối PENDING, ghi lý do và trả hạn mức hoàn (BR-CANCEL-17). */
export const refundRejectRequestSchema = z.strictObject({
  note: z.string().min(1).max(500),
  pinToken: z.string().min(16).optional(),
});

/** Rút yêu cầu còn PENDING; không khôi phục booking (BR-CANCEL-18). */
export const refundCancelRequestSchema = z.strictObject({
  reason: z.string().min(1).max(500),
});

/** 🔒 Chi tiền hoàn về phương thức gốc, chỉ khi APPROVED (BR-CANCEL-16, BR-PAY-08). */
export const refundPayRequestSchema = z.strictObject({
  method: paymentMethodSchema,
  bankNote: z.string().max(500).optional(),
  pinToken: z.string().min(16).optional(),
});

/** Phản hồi duyệt (§3.7). */
export const refundDecisionSchema = z.object({
  id: z.string().min(1),
  status: refundStatusSchema,
  requestedAmount: z.number().int().min(0),
  approvedAmount: z.number().int().min(0),
  refundPercent: percent,
  requestedBy: z.string().min(1),
  approvedBy: z.string().min(1),
  decidedAt: isoUtcTimestampSchema,
  auditLogId: z.string().min(1),
  payoutDeadline: isoUtcTimestampSchema,
});

export const refundListQuerySchema = listQuerySchema.extend({
  bookingId: z.string().min(1).optional(),
  propertyId: z.string().min(1).optional(),
  status: refundStatusSchema.optional(),
});

export type RefundRequest = z.infer<typeof refundRequestSchema>;
export type RefundRequestCreateRequest = z.infer<typeof refundRequestCreateRequestSchema>;
export type RefundApproveRequest = z.infer<typeof refundApproveRequestSchema>;
export type RefundRejectRequest = z.infer<typeof refundRejectRequestSchema>;
export type RefundCancelRequest = z.infer<typeof refundCancelRequestSchema>;
export type RefundPayRequest = z.infer<typeof refundPayRequestSchema>;
export type RefundDecision = z.infer<typeof refundDecisionSchema>;
export type RefundListQuery = z.infer<typeof refundListQuerySchema>;
