/**
 * Hợp đồng PAY — api.md §2.6, §3.5, §5.2; csdl §3 (payments, payment_allocations).
 * **KHÔNG** có trường dữ liệu thẻ/CVV/ngày hết hạn ở bất kỳ request nào (§2.14, NFR-SEC-02).
 */
import { z } from 'zod';
import { isoUtcTimestampSchema } from './common.js';
import { paymentMethodSchema, paymentStatusSchema, paymentTypeSchema } from './enums.js';

/** `POST /payments` — thu tại quầy; 🔒 PIN 6 số, `pinToken` do client chèn khi có (QĐ-01 mục 6). */
export const paymentCreateRequestSchema = z.strictObject({
  bookingId: z.string().min(1),
  type: paymentTypeSchema,
  method: paymentMethodSchema,
  /** Tiền VND nguyên; `amount` phải khớp cọc/số dư máy chủ tính (BR-PAY-01,02). */
  amount: z.number().int().positive(),
  note: z.string().max(500).optional(),
  pinToken: z.string().min(16).optional(),
});

/** `POST /payments/online` — khởi tạo thanh toán trực tuyến; kết quả cuối do PSP xác nhận (§3.5). */
export const onlinePaymentCreateRequestSchema = z.strictObject({
  bookingId: z.string().min(1),
  type: paymentTypeSchema,
  method: paymentMethodSchema,
  amount: z.number().int().positive(),
  returnUrl: z.string().url(),
});

export const paymentSchema = z.object({
  paymentId: z.string().min(1),
  bookingId: z.string().min(1),
  type: paymentTypeSchema,
  method: paymentMethodSchema,
  amount: z.number().int().positive(),
  status: paymentStatusSchema,
  /** Mã giao dịch PSP; lưu để đối chiếu, **không** lưu dữ liệu thẻ (BR-PAY-04). */
  providerTxnId: z.string().min(1).nullable(),
  paymentUrl: z.string().min(1).nullable(),
  expiresAt: isoUtcTimestampSchema.nullable(),
  paidAt: isoUtcTimestampSchema.nullable(),
  createdAt: isoUtcTimestampSchema,
  /** Người ghi khoản thu do server xác định (BR-PAY-06); optional để đọc phản hồi cũ. */
  createdBy: z.string().min(1).nullable().optional(),
});

/** `GET /payments/{paymentId}/status` — đọc lại sau khi PSP chuyển hướng (BR-PAY-05). */
export const paymentStatusViewSchema = z.object({
  paymentId: z.string().min(1),
  bookingId: z.string().min(1),
  status: paymentStatusSchema,
  amount: z.number().int().positive(),
  providerTxnId: z.string().min(1).nullable(),
  paidAt: isoUtcTimestampSchema.nullable(),
});

/** `GET /bookings/{bookingId}/balance` — tách đã thu / còn nợ / hoàn đang giữ hạn mức (BR-PAY-02). */
export const bookingBalanceSchema = z.object({
  bookingId: z.string().min(1),
  currency: z.literal('VND'),
  totalAmount: z.number().int().min(0),
  paidAmount: z.number().int().min(0),
  refundedAmount: z.number().int().min(0),
  /** Hoàn đang giữ hạn mức ở các yêu cầu chưa kết thúc — không tính là đã chi. */
  reservedRefundAmount: z.number().int().min(0),
  balanceDue: z.number().int().min(0),
});

/**
 * IPN VNPay (§5.2) — tham số query theo giao thức provider, `passthrough` để không chặn trường lạ
 * của phiên bản provider. Chỉ để backend dùng; **không** khai trong client frontend (HB-090 AC4).
 */
export const vnpayCallbackQuerySchema = z
  .object({
    vnp_TxnRef: z.string().min(1),
    vnp_Amount: z.string().min(1),
    vnp_ResponseCode: z.string().min(1),
    vnp_TransactionNo: z.string().min(1).optional(),
    vnp_SecureHash: z.string().min(1),
  })
  .passthrough();

/** IPN MoMo (§5.2) — JSON theo giao thức provider; chữ ký xác minh constant-time phía backend. */
export const momoCallbackSchema = z
  .object({
    partnerCode: z.string().min(1),
    orderId: z.string().min(1),
    requestId: z.string().min(1),
    amount: z.number().int(),
    resultCode: z.number().int(),
    transId: z.union([z.string(), z.number()]).optional(),
    signature: z.string().min(1),
  })
  .passthrough();

export type Payment = z.infer<typeof paymentSchema>;
export type PaymentCreateRequest = z.infer<typeof paymentCreateRequestSchema>;
export type OnlinePaymentCreateRequest = z.infer<typeof onlinePaymentCreateRequestSchema>;
export type PaymentStatusView = z.infer<typeof paymentStatusViewSchema>;
export type BookingBalance = z.infer<typeof bookingBalanceSchema>;
