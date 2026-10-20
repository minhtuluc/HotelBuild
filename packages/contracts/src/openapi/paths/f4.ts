/**
 * Path OpenAPI pha F4 (journey khách: availability, quotes, bookings, confirm, holds) — HB-070.
 * `registry.ts` chỉ gọi `registerF4Paths`. `availability` và `quotes` **công khai** (api.md §2.3/§2.4;
 * §6.3 "tìm phòng, báo giá" là nhóm công khai); bookings/holds cần Bearer GUEST hoặc nhân viên.
 * Ràng buộc âm (§2.14): không tuyến ghi price snapshot; huỷ/đổi ngày/DELETE booking thuộc F5 (HB-090).
 */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import { listResponseSchema } from '../../common.js';
import { availabilityQuerySchema, availabilitySchema } from '../../inventory.js';
import {
  bookingConfirmRequestSchema,
  bookingsQuerySchema,
  bookingCreateRequestSchema,
  bookingSummarySchema,
  holdCreateRequestSchema,
  holdReleaseQuerySchema,
  holdSchema,
} from '../../booking.js';
import { quoteRequestSchema, quoteSchema } from '../../quote.js';
import { walkInRequestSchema, walkInResultSchema } from '../../walk-in.js';
import {
  bearerWrite,
  idempotencyHeaders,
  jsonBody,
  makeErrorResponse,
  pathParam,
} from '../shared.js';

export function registerF4Paths(registry: OpenAPIRegistry, errorBodyComponent: z.ZodTypeAny): void {
  const errorResponse = makeErrorResponse(errorBodyComponent);
  const bearerRead = { security: [{ bearerAuth: [] }] };

  registry.registerPath({
    method: 'get',
    path: '/api/v1/inventory/availability',
    operationId: 'inventoryAvailability',
    summary: 'Tìm phòng trống theo kỳ lưu trú — chỉ đọc (UC-INV-02, BR-INV-01,02,07)',
    tags: ['inventory'],
    // Công khai (api.md §2.3 vai trò "—"): khách tìm phòng trước khi đăng nhập journey F4.
    request: { query: availabilityQuerySchema },
    responses: {
      200: { description: 'Loại phòng còn chỗ cho kỳ', ...jsonBody(availabilitySchema) },
      400: errorResponse('E_GEN_VALIDATION_FAILED'),
      409: errorResponse('E_INV_NO_AVAILABILITY'),
      422: errorResponse('E_BOOK_OVER_CAPACITY'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/quotes',
    operationId: 'quotesCreate',
    summary: 'Báo giá kỳ lưu trú, bất biến trong TTL (UC-RATE-05, BR-RATE-15,17)',
    tags: ['rate'],
    // Công khai: khách xem giá trước khi đăng nhập (§6.3).
    parameters: idempotencyHeaders,
    request: { body: jsonBody(quoteRequestSchema) },
    responses: {
      201: { description: 'Báo giá', ...jsonBody(quoteSchema) },
      400: errorResponse('E_BOOK_MISSING_FIELD'),
      409: errorResponse('E_INV_NO_AVAILABILITY', 'E_RATE_QUOTE_MISMATCH'),
      410: errorResponse('E_RATE_QUOTE_EXPIRED'),
      422: errorResponse('E_BOOK_OVER_CAPACITY', 'E_BOOK_MIN_NIGHTS', 'E_RATE_PROMO_INVALID'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/bookings',
    operationId: 'bookingsCreate',
    summary: 'Tạo booking — mặc định HELD tới khi đủ cọc (UC-BOOK-01, BR-BOOK-09,16)',
    ...bearerWrite(['booking']),
    request: { body: jsonBody(bookingCreateRequestSchema) },
    responses: {
      201: { description: 'Booking đã tạo', ...jsonBody(bookingSummarySchema) },
      400: errorResponse('E_BOOK_MISSING_FIELD'),
      403: errorResponse('E_BOOK_BLACKLISTED', 'E_RBAC_FORBIDDEN'),
      409: errorResponse('E_INV_NO_AVAILABILITY', 'E_INV_ROOM_TAKEN', 'E_OVER_LIMIT_EXCEEDED'),
      410: errorResponse('E_RATE_QUOTE_EXPIRED'),
      422: errorResponse('E_BOOK_OVER_CAPACITY', 'E_BOOK_MIN_NIGHTS'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/walk-in',
    operationId: 'walkInCreate',
    summary: 'Walk-in: quote → booking kênh WALKIN trong một lệnh (UC-BOOK-02, BR-BOOK-07)',
    ...bearerWrite(['booking']),
    request: { body: jsonBody(walkInRequestSchema) },
    responses: {
      201: { description: 'Booking walk-in đã tạo', ...jsonBody(walkInResultSchema) },
      200: {
        description: 'Booking đã có — BR-BOOK-16 trả bản cũ kèm cờ duplicateSuspected',
        ...jsonBody(walkInResultSchema),
      },
      400: errorResponse('E_GEN_VALIDATION_FAILED', 'E_BOOK_MISSING_FIELD'),
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE', 'E_BOOK_BLACKLISTED'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_BOOK_INVALID_STATE', 'E_INV_NO_AVAILABILITY', 'E_INV_ROOM_TAKEN'),
      422: errorResponse('E_BOOK_OVER_CAPACITY', 'E_BOOK_MIN_NIGHTS', 'E_BOOK_INVALID_DATES'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/bookings',
    operationId: 'bookingsList',
    summary: 'Tra cứu booking — khách chỉ booking của mình, nhân viên theo phạm vi (UC-BOOK-07)',
    tags: ['booking'],
    ...bearerRead,
    request: { query: bookingsQuerySchema },
    responses: {
      200: {
        description: 'Danh sách booking',
        ...jsonBody(listResponseSchema(bookingSummarySchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/bookings/{bookingId}',
    operationId: 'bookingsGet',
    summary: 'Chi tiết booking kèm snapshot điều khoản và version (UC-BOOK-07, BR-BOOK-17)',
    tags: ['booking'],
    ...bearerRead,
    parameters: [pathParam('bookingId')],
    responses: {
      200: { description: 'Chi tiết booking', ...jsonBody(bookingSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/bookings/{bookingId}/confirm',
    operationId: 'bookingsConfirm',
    summary: 'Xác nhận booking khi đã đủ cọc (UC-BOOK-01, BR-BOOK-09)',
    ...bearerWrite(['booking']),
    parameters: [...idempotencyHeaders, pathParam('bookingId')],
    request: { body: jsonBody(bookingConfirmRequestSchema) },
    responses: {
      200: { description: 'Booking đã xác nhận', ...jsonBody(bookingSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_BOOK_INVALID_STATE'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/holds',
    operationId: 'holdsCreate',
    summary: 'Giữ chỗ có thời hạn theo Channel.holdMinutes (UC-BOOK-04, BR-BOOK-07, BR-INV-02)',
    ...bearerWrite(['booking']),
    request: { body: jsonBody(holdCreateRequestSchema) },
    responses: {
      201: { description: 'Hold đang giữ chỗ', ...jsonBody(holdSchema) },
      400: errorResponse('E_BOOK_MISSING_FIELD'),
      409: errorResponse(
        'E_INV_NO_AVAILABILITY',
        'E_INV_ROOM_TAKEN',
        'E_INV_LOCK_TIMEOUT',
        'E_BOOK_INVALID_STATE',
      ),
      410: errorResponse('E_RATE_QUOTE_EXPIRED'),
      422: errorResponse('E_BOOK_OVER_CAPACITY'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/holds/{holdId}',
    operationId: 'holdsRelease',
    summary: 'Giải phóng hold ngay, trả phòng về tồn khả dụng (UC-BOOK-04, BR-INV-04)',
    ...bearerWrite(['booking']),
    parameters: [...idempotencyHeaders, pathParam('holdId')],
    request: { query: holdReleaseQuerySchema },
    responses: {
      204: { description: 'Đã giải phóng hold' },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_BOOK_INVALID_STATE'),
    },
  });
}
