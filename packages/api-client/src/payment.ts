/**
 * Bề mặt F5 (HB-090): thanh toán và hoàn tiền.
 * Lệnh 🔒 gửi `pinProtected` để client chèn `pinToken` đã xác thực (QĐ-01 mục 6, api.md §2.6).
 * Callback PSP (§5.2) **không** có ở đây — chỉ backend dùng.
 */
import {
  bookingBalanceSchema,
  listResponseSchema,
  onlinePaymentCreateRequestSchema,
  paymentCreateRequestSchema,
  paymentSchema,
  paymentStatusViewSchema,
  refundApproveRequestSchema,
  refundCancelRequestSchema,
  refundConfirmTransferRequestSchema,
  refundDecisionSchema,
  refundPayRequestSchema,
  refundPayoutViewSchema,
  refundRejectRequestSchema,
  refundRequestCreateRequestSchema,
  refundRequestSchema,
  type BookingBalance,
  type ListPage,
  type OnlinePaymentCreateRequest,
  type Payment,
  type PaymentCreateRequest,
  type PaymentStatusView,
  type RefundApproveRequest,
  type RefundCancelRequest,
  type RefundConfirmTransferRequest,
  type RefundDecision,
  type RefundPayRequest,
  type RefundPayoutView,
  type RefundRejectRequest,
  type RefundRequest,
  type RefundRequestCreateRequest,
} from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from './client.js';

export interface PaymentApi {
  /** 🔒 Thu tại quầy; PIN gắn người, hành động, đối tượng và amount (BR-PAY-06). */
  create(input: PaymentCreateRequest): Promise<ApiResponse<Payment>>;
  createOnline(input: OnlinePaymentCreateRequest): Promise<ApiResponse<Payment>>;
  status(paymentId: string): Promise<ApiResponse<PaymentStatusView>>;
  balance(bookingId: string): Promise<ApiResponse<BookingBalance>>;
}

export function createPaymentApi(client: ApiClient): PaymentApi {
  return {
    create: (input) =>
      client.request({
        method: 'POST',
        path: '/payments',
        body: paymentCreateRequestSchema.parse(input),
        pinProtected: true,
        decoder: paymentSchema,
      }),
    createOnline: (input) =>
      client.request({
        method: 'POST',
        path: '/payments/online',
        body: onlinePaymentCreateRequestSchema.parse(input),
        decoder: paymentSchema,
      }),
    status: (paymentId) =>
      client.request({
        method: 'GET',
        path: `/payments/${encodeURIComponent(paymentId)}/status`,
        decoder: paymentStatusViewSchema,
      }),
    balance: (bookingId) =>
      client.request({
        method: 'GET',
        path: `/bookings/${encodeURIComponent(bookingId)}/balance`,
        decoder: bookingBalanceSchema,
      }),
  };
}

export interface RefundApi {
  create(input: RefundRequestCreateRequest): Promise<ApiResponse<RefundRequest>>;
  list(query?: {
    bookingId?: string;
    propertyId?: string;
    status?: RefundRequest['status'];
    limit?: number;
    cursor?: string;
  }): Promise<ApiResponse<ListPage<RefundRequest>>>;
  /** 🔒 Duyệt hoàn; người duyệt ≠ người lập (BR-CANCEL-15). */
  approve(
    refundRequestId: string,
    input: RefundApproveRequest,
  ): Promise<ApiResponse<RefundDecision>>;
  reject(refundRequestId: string, input: RefundRejectRequest): Promise<ApiResponse<RefundRequest>>;
  cancel(refundRequestId: string, input: RefundCancelRequest): Promise<ApiResponse<RefundRequest>>;
  /** 🔒 Chi hoàn về phương thức gốc, chỉ khi APPROVED (BR-CANCEL-16). */
  pay(
    refundRequestId: string,
    input: RefundPayRequest,
    options?: { idempotencyKey: string },
  ): Promise<ApiResponse<RefundRequest>>;
  /**
   * 🔒 HB-215: xác nhận đã chuyển khoản tay bằng mã tham chiếu ngân hàng cho leg chờ đối soát.
   * Chỉ hợp lệ khi server báo `awaitingTransferConfirmation`.
   */
  confirmTransfer(
    refundRequestId: string,
    input: RefundConfirmTransferRequest,
    options?: { idempotencyKey: string },
  ): Promise<ApiResponse<RefundPayoutView>>;
}

export function createRefundApi(client: ApiClient): RefundApi {
  return {
    create: (input) =>
      client.request({
        method: 'POST',
        path: '/refund-requests',
        body: refundRequestCreateRequestSchema.parse(input),
        decoder: refundRequestSchema,
      }),
    list: (query) =>
      client.request({
        method: 'GET',
        path: '/refund-requests',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(refundRequestSchema),
      }),
    approve: (refundRequestId, input) =>
      client.request({
        method: 'POST',
        path: `/refund-requests/${encodeURIComponent(refundRequestId)}/approve`,
        body: refundApproveRequestSchema.parse(input),
        pinProtected: true,
        decoder: refundDecisionSchema,
      }),
    reject: (refundRequestId, input) =>
      client.request({
        method: 'POST',
        path: `/refund-requests/${encodeURIComponent(refundRequestId)}/reject`,
        body: refundRejectRequestSchema.parse(input),
        pinProtected: true,
        decoder: refundRequestSchema,
      }),
    cancel: (refundRequestId, input) =>
      client.request({
        method: 'POST',
        path: `/refund-requests/${encodeURIComponent(refundRequestId)}/cancel`,
        body: refundCancelRequestSchema.parse(input),
        decoder: refundRequestSchema,
      }),
    pay: (refundRequestId, input, options) =>
      client.request({
        method: 'POST',
        path: `/refund-requests/${encodeURIComponent(refundRequestId)}/pay`,
        body: refundPayRequestSchema.parse(input),
        ...(options === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        pinProtected: true,
        decoder: refundRequestSchema,
      }),
    confirmTransfer: (refundRequestId, input, options) =>
      client.request({
        method: 'POST',
        path: `/refund-requests/${encodeURIComponent(refundRequestId)}/confirm-transfer`,
        body: refundConfirmTransferRequestSchema.parse(input),
        ...(options === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        pinProtected: true,
        decoder: refundPayoutViewSchema,
      }),
  };
}
