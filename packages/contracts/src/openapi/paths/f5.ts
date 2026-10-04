/**
 * Path OpenAPI pha F5 (thanh toán, huỷ/hoàn, đổi ngày, xoá booking) — HB-090.
 * `registry.ts` chỉ gọi `registerF5Paths`. Lệnh 🔒 (thu tiền tại quầy, duyệt/chi hoàn) khai
 * `pinToken` trong body theo QĐ-01 mục 6. Callback PSP (§5.2) chỉ khai ở đây cho backend, **không**
 * có trong client frontend. Ràng buộc âm (§2.14): không endpoint nào nhận dữ liệu thẻ/CVV.
 */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import { listResponseSchema } from '../../common.js';
import { bookingSummarySchema } from '../../booking.js';
import {
  bookingDeleteQuerySchema,
  cancelPreviewRequestSchema,
  cancelPreviewSchema,
  cancelRequestSchema,
  cancelResponseSchema,
  rescheduleRequestSchema,
} from '../../cancellation.js';
import {
  bookingBalanceSchema,
  momoCallbackSchema,
  onlinePaymentCreateRequestSchema,
  paymentCreateRequestSchema,
  paymentSchema,
  paymentStatusViewSchema,
  vnpayCallbackQuerySchema,
} from '../../payment.js';
import {
  refundApproveRequestSchema,
  refundCancelRequestSchema,
  refundDecisionSchema,
  refundListQuerySchema,
  refundPayRequestSchema,
  refundRejectRequestSchema,
  refundRequestCreateRequestSchema,
  refundRequestSchema,
} from '../../refund.js';
import {
  bearerWrite,
  idempotencyHeaders,
  jsonBody,
  makeErrorResponse,
  pathParam,
} from '../shared.js';

export function registerF5Paths(registry: OpenAPIRegistry, errorBodyComponent: z.ZodTypeAny): void {
  const errorResponse = makeErrorResponse(errorBodyComponent);
  const bearerRead = { security: [{ bearerAuth: [] }] };

  registry.registerPath({
    method: 'post',
    path: '/api/v1/bookings/{bookingId}/cancel-preview',
    operationId: 'bookingsCancelPreview',
    summary:
      'Xem trước tiền hoàn theo bậc chính sách, không đổi trạng thái (UC-BOOK-08, BR-CANCEL-01…06)',
    ...bearerWrite(['booking']),
    parameters: [...idempotencyHeaders, pathParam('bookingId')],
    request: { body: jsonBody(cancelPreviewRequestSchema) },
    responses: {
      200: { description: 'Xem trước hoàn tiền', ...jsonBody(cancelPreviewSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_CANCEL_NOT_ALLOWED'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/bookings/{bookingId}/cancel',
    operationId: 'bookingsCancel',
    summary: 'Huỷ booking toàn phần/một phần, tạo RefundRequest (UC-BOOK-08, BR-BOOK-11,14)',
    ...bearerWrite(['booking']),
    parameters: [...idempotencyHeaders, pathParam('bookingId')],
    request: { body: jsonBody(cancelRequestSchema) },
    responses: {
      200: { description: 'Kết quả huỷ', ...jsonBody(cancelResponseSchema) },
      400: errorResponse('E_PAY_REASON_TOO_SHORT'),
      403: errorResponse('E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN', 'E_RBAC_FORBIDDEN'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_CANCEL_NOT_ALLOWED'),
      422: errorResponse('E_PAY_REFUND_EXCEEDS_PAID'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/bookings/{bookingId}/reschedule',
    operationId: 'bookingsReschedule',
    summary: 'Đổi ngày, lưu PriceSnapshot RESCHEDULE và giữ bản cũ (UC-BOOK-06, BR-BOOK-12,13)',
    ...bearerWrite(['booking']),
    parameters: [...idempotencyHeaders, pathParam('bookingId')],
    request: { body: jsonBody(rescheduleRequestSchema) },
    responses: {
      200: { description: 'Booking sau đổi ngày', ...jsonBody(bookingSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_BOOK_INVALID_STATE', 'E_INV_NO_AVAILABILITY'),
      422: errorResponse('E_BOOK_MIN_NIGHTS', 'E_BOOK_OVER_CAPACITY'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/bookings/{bookingId}',
    operationId: 'bookingsDelete',
    summary:
      'Xoá cứng DRAFT/HELD chưa phát sinh thanh toán, audit beforeJson (UC-BOOK-05, BR-BOOK-14)',
    ...bearerWrite(['booking']),
    parameters: [...idempotencyHeaders, pathParam('bookingId')],
    request: { query: bookingDeleteQuerySchema },
    responses: {
      204: { description: 'Đã xoá booking' },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_BOOK_HARD_DELETE_FORBIDDEN'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/payments',
    operationId: 'paymentsCreate',
    summary: 'Thu tiền tại quầy (cọc/số dư/khác) — 🔒 PIN, PIN gắn người và amount (UC-PAY-01,03)',
    ...bearerWrite(['pay']),
    request: { body: jsonBody(paymentCreateRequestSchema) },
    responses: {
      201: { description: 'Khoản thu đã ghi', ...jsonBody(paymentSchema) },
      401: errorResponse('E_AUTH_PIN_REQUIRED'),
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      409: errorResponse('E_BOOK_INVALID_STATE'),
      422: errorResponse('E_PAY_AMOUNT_MISMATCH'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/payments/online',
    operationId: 'paymentsOnlineCreate',
    summary: 'Khởi tạo thanh toán trực tuyến; kết quả cuối do PSP xác nhận (UC-PAY-02, BR-PAY-03)',
    ...bearerWrite(['pay']),
    request: { body: jsonBody(onlinePaymentCreateRequestSchema) },
    responses: {
      201: { description: 'Giao dịch PENDING và URL PSP', ...jsonBody(paymentSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      422: errorResponse('E_PAY_AMOUNT_MISMATCH'),
      502: errorResponse('E_PAY_GATEWAY_ERROR'),
      504: errorResponse('E_PAY_GATEWAY_TIMEOUT'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/payments/{paymentId}/status',
    operationId: 'paymentsStatus',
    summary: 'Đọc lại trạng thái giao dịch sau khi PSP chuyển hướng (UC-PAY-02, BR-PAY-05)',
    tags: ['pay'],
    ...bearerRead,
    parameters: [pathParam('paymentId')],
    responses: {
      200: { description: 'Trạng thái giao dịch', ...jsonBody(paymentStatusViewSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/bookings/{bookingId}/balance',
    operationId: 'bookingsBalance',
    summary: 'Số dư booking: đã thu, còn nợ, hoàn đang giữ hạn mức (UC-PAY-03, BR-PAY-02)',
    tags: ['pay'],
    ...bearerRead,
    parameters: [pathParam('bookingId')],
    responses: {
      200: { description: 'Số dư booking', ...jsonBody(bookingBalanceSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/refund-requests',
    operationId: 'refundRequestsCreate',
    summary: 'Lập hồ sơ hoàn từ nghiệp vụ (UC-PAY-04, BR-CANCEL-01…07,13)',
    ...bearerWrite(['refund']),
    request: { body: jsonBody(refundRequestCreateRequestSchema) },
    responses: {
      201: { description: 'Hồ sơ hoàn PENDING', ...jsonBody(refundRequestSchema) },
      400: errorResponse('E_PAY_REASON_TOO_SHORT'),
      403: errorResponse('E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN', 'E_RBAC_FORBIDDEN'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_PAY_REFUND_NOT_PENDING'),
      422: errorResponse('E_PAY_REFUND_EXCEEDS_PAID'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/refund-requests',
    operationId: 'refundRequestsList',
    summary: 'Danh sách hồ sơ hoàn kèm số tiền đã giữ/chi và version (UC-PAY-04, BR-CANCEL-16)',
    tags: ['refund'],
    ...bearerRead,
    request: { query: refundListQuerySchema },
    responses: {
      200: {
        description: 'Danh sách hồ sơ hoàn',
        ...jsonBody(listResponseSchema(refundRequestSchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/refund-requests/{refundRequestId}/approve',
    operationId: 'refundRequestsApprove',
    summary: 'Duyệt hoàn — 🔒 PIN, người duyệt ≠ người lập (UC-PAY-04, BR-CANCEL-15)',
    ...bearerWrite(['refund']),
    parameters: [...idempotencyHeaders, pathParam('refundRequestId')],
    request: { body: jsonBody(refundApproveRequestSchema) },
    responses: {
      200: { description: 'Hồ sơ đã duyệt', ...jsonBody(refundDecisionSchema) },
      401: errorResponse('E_AUTH_PIN_REQUIRED'),
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_PAY_SELF_APPROVAL'),
      409: errorResponse('E_PAY_REFUND_NOT_PENDING'),
      422: errorResponse('E_PAY_AMOUNT_MISMATCH'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/refund-requests/{refundRequestId}/reject',
    operationId: 'refundRequestsReject',
    summary: 'Từ chối PENDING, ghi lý do và trả hạn mức hoàn — 🔒 PIN (UC-PAY-04, BR-CANCEL-17)',
    ...bearerWrite(['refund']),
    parameters: [...idempotencyHeaders, pathParam('refundRequestId')],
    request: { body: jsonBody(refundRejectRequestSchema) },
    responses: {
      200: { description: 'Hồ sơ đã từ chối', ...jsonBody(refundRequestSchema) },
      401: errorResponse('E_AUTH_PIN_REQUIRED'),
      403: errorResponse('E_RBAC_FORBIDDEN'),
      409: errorResponse('E_PAY_REFUND_NOT_PENDING'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/refund-requests/{refundRequestId}/cancel',
    operationId: 'refundRequestsCancel',
    summary: 'Rút yêu cầu còn PENDING; không khôi phục booking (UC-PAY-04, BR-CANCEL-18)',
    ...bearerWrite(['refund']),
    parameters: [...idempotencyHeaders, pathParam('refundRequestId')],
    request: { body: jsonBody(refundCancelRequestSchema) },
    responses: {
      200: { description: 'Hồ sơ đã rút', ...jsonBody(refundRequestSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN'),
      409: errorResponse('E_PAY_REFUND_NOT_PENDING'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/refund-requests/{refundRequestId}/pay',
    operationId: 'refundRequestsPay',
    summary: 'Chi hoàn về phương thức gốc — 🔒 PIN, chỉ khi APPROVED (UC-PAY-04, BR-CANCEL-16)',
    ...bearerWrite(['refund']),
    parameters: [...idempotencyHeaders, pathParam('refundRequestId')],
    request: { body: jsonBody(refundPayRequestSchema) },
    responses: {
      200: { description: 'Hồ sơ đã chi', ...jsonBody(refundRequestSchema) },
      401: errorResponse('E_AUTH_PIN_REQUIRED'),
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN'),
      409: errorResponse('E_PAY_REFUND_NOT_APPROVED'),
    },
  });

  // Callback PSP (§5.2) — giao thức provider, xác thực bằng chữ ký; KHÔNG dùng cho client frontend.
  registry.registerPath({
    method: 'get',
    path: '/api/v1/integrations/psp/vnpay/callback',
    operationId: 'pspVnpayCallback',
    summary: 'IPN VNPay: xác minh chữ ký trước ghi tiền, ghi bền rồi ACK (BR-PAY-03, NFR-SEC-05)',
    tags: ['integration'],
    request: { query: vnpayCallbackQuerySchema },
    responses: {
      200: { description: 'ACK theo RspCode của VNPay' },
      401: errorResponse('E_PAY_SIGNATURE_INVALID'),
      422: errorResponse('E_PAY_AMOUNT_MISMATCH'),
      503: errorResponse('E_GEN_SERVICE_UNAVAILABLE'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/integrations/psp/momo/callback',
    operationId: 'pspMomoCallback',
    summary:
      'IPN MoMo: xác minh chữ ký, chống phát lại, ACK 204 không body (BR-PAY-03, NFR-REL-06)',
    tags: ['integration'],
    request: { body: jsonBody(momoCallbackSchema) },
    responses: {
      204: { description: 'Đã ghi nhận (body rỗng theo giao thức MoMo)' },
      401: errorResponse('E_PAY_SIGNATURE_INVALID'),
      422: errorResponse('E_PAY_AMOUNT_MISMATCH'),
      503: errorResponse('E_GEN_SERVICE_UNAVAILABLE'),
    },
  });
}
