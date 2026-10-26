/** Hợp đồng hoàn tiền — api.md §2.6, §3.6, §3.7; csdl §3 (refund_requests, refund_tiers). */
import { z } from 'zod';
import { isoUtcTimestampSchema, listQuerySchema } from './common.js';
import { cancelReasonSchema, paymentMethodSchema, refundStatusSchema } from './enums.js';
import { paymentSchema } from './payment.js';

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
  /** Facts do server tính; optional để phản hồi cũ vẫn đọc được (BR-CANCEL-05/15). */
  netRefund: z.number().int().safe().min(0).optional(),
  eventNetRefund: z.number().int().safe().min(0).optional(),
  /** Cờ theo ngưỡng cấu hình của server, không hardcode SystemSetting ở frontend. */
  requiresThresholdControl: z.boolean().optional(),
  /**
   * HB-215: hồ sơ `APPROVED` có leg chuyển khoản tay đang chờ kế toán xác nhận
   * (`refund_payout_operations.status='UNKNOWN'` + `last_error='MANUAL_TRANSFER_AWAITING_CONFIRMATION'`).
   * Do server tính; optional để phản hồi cũ vẫn đọc được.
   */
  awaitingTransferConfirmation: z.boolean().optional(),
  /** Nguồn hoàn và Payment REFUND riêng, không sửa Payment thu gốc (BR-PAY-08/09). */
  refundAllocations: z
    .array(
      z.object({
        amount: z.number().int().safe().min(0),
        payoutMethod: paymentMethodSchema,
        originalPayment: paymentSchema,
        refundPayment: paymentSchema.nullable(),
      }),
    )
    .optional(),
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
  approvedAmount: z.number().int().min(0),
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

/**
 * 🔒 HB-215 / api.md §2.6: kế toán xác nhận **đã chuyển khoản** cho leg chờ đối soát. `bankReference`
 * là mã tham chiếu giao dịch ngân hàng (bắt buộc, không nhận chuỗi rỗng); ngoài mã, phải có **thêm**
 * `note` hoặc `evidenceRefs[]` làm bằng chứng chứ không chỉ một mã trần.
 */
export const refundConfirmTransferRequestSchema = z.strictObject({
  bankReference: z.string().trim().min(1).max(64),
  note: z.string().max(500).optional(),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  pinToken: z.string().min(16).optional(),
});

/** Trạng thái **kỹ thuật** của một leg chi (`refund_payout_operations.status`, ADR-016). */
export const payoutOperationStatusSchema = z.enum([
  'READY',
  'IN_FLIGHT',
  'UNKNOWN',
  'SUCCEEDED',
  'FAILED_FINAL',
]);

/**
 * HB-215: phản hồi của `/pay` và `/confirm-transfer`. `lastError` là mã lý do kỹ thuật để kế toán
 * biết leg đang chờ xác nhận chuyển khoản tay; không chứa số tài khoản hay `pinToken`.
 */
export const refundPayoutOperationSchema = z.object({
  id: z.string().min(1),
  status: payoutOperationStatusSchema,
  method: paymentMethodSchema,
  amount: z.number().int().safe().min(0),
  originalPaymentId: z.string().min(1),
  refundPaymentId: z.string().min(1),
  bankNote: z.string().nullable(),
  attempts: z.number().int().min(0),
  providerTxnId: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: isoUtcTimestampSchema,
  finishedAt: isoUtcTimestampSchema.nullable(),
});

export const refundPayoutViewSchema = z.object({
  refundRequestId: z.string().min(1),
  status: refundStatusSchema,
  operations: z.array(refundPayoutOperationSchema),
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
export type RefundConfirmTransferRequest = z.infer<typeof refundConfirmTransferRequestSchema>;
export type RefundPayoutOperation = z.infer<typeof refundPayoutOperationSchema>;
export type RefundPayoutView = z.infer<typeof refundPayoutViewSchema>;
export type RefundDecision = z.infer<typeof refundDecisionSchema>;
export type RefundListQuery = z.infer<typeof refundListQuerySchema>;
