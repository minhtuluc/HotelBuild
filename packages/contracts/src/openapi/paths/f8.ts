/**
 * Path OpenAPI pha F8 (báo cáo, xuất báo cáo, thông báo) — HB-160.
 * Vai trò theo api.md §2.12/§2.11: báo cáo tài chính ACCOUNTANT, `force-majeure` OWNER,
 * `occupancy`/`adr-revpar`/`overbooking` MANAGER+. Ràng buộc âm §2.14: không có `DELETE /guests/{id}`.
 * Phần CRM quản trị trong `guest.ts` (anonymize/loyalty/blacklist) thuộc cùng ticket, khai ở HB-160 phần 2.
 */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import { operationRefSchema } from '../../common.js';
import {
  adrRevparReportQuerySchema,
  adrRevparReportSchema,
  cancellationsReportQuerySchema,
  cancellationsReportSchema,
  forceMajeureReportQuerySchema,
  forceMajeureReportSchema,
  occupancyReportQuerySchema,
  occupancyReportSchema,
  overbookingReportQuerySchema,
  overbookingReportSchema,
  reportExportRequestSchema,
  revenueByChannelQuerySchema,
  revenueByChannelReportSchema,
} from '../../report.js';
import {
  notificationQuerySchema,
  notificationResendRequestSchema,
  notificationSummarySchema,
} from '../../notification.js';
import {
  guestAnonymizeRequestSchema,
  guestBlacklistReleaseQuerySchema,
  guestBlacklistRequestSchema,
  guestLoyaltySchema,
  guestSummarySchema,
} from '../../guest.js';
import { listResponseSchema } from '../../common.js';
import {
  bearerWrite,
  idempotencyHeaders,
  jsonBody,
  makeErrorResponse,
  pathParam,
} from '../shared.js';

export function registerF8Paths(registry: OpenAPIRegistry, errorBodyComponent: z.ZodTypeAny): void {
  const errorResponse = makeErrorResponse(errorBodyComponent);
  const bearerRead = { security: [{ bearerAuth: [] }] };

  registry.registerPath({
    method: 'get',
    path: '/api/v1/reports/occupancy',
    operationId: 'reportsOccupancy',
    summary: 'Công suất theo ngày/loại phòng/cơ sở — DOR đếm theo đơn vị bán (UC-REP-01)',
    tags: ['rep'],
    ...bearerRead,
    request: { query: occupancyReportQuerySchema },
    responses: {
      200: { description: 'Báo cáo công suất', ...jsonBody(occupancyReportSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/reports/adr-revpar',
    operationId: 'reportsAdrRevpar',
    summary: 'ADR, RevPAR, phòng-đêm đã bán/khả dụng trên doanh thu thuần (UC-REP-01, BR-REP-01)',
    tags: ['rep'],
    ...bearerRead,
    request: { query: adrRevparReportQuerySchema },
    responses: {
      200: { description: 'Báo cáo ADR/RevPAR', ...jsonBody(adrRevparReportSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/reports/revenue-by-channel',
    operationId: 'reportsRevenueByChannel',
    summary: 'Doanh thu gộp/thuần & hoa hồng theo kênh — ACCOUNTANT (UC-REP-02, BR-RATE-08)',
    tags: ['rep'],
    ...bearerRead,
    request: { query: revenueByChannelQuerySchema },
    responses: {
      200: { description: 'Doanh thu theo kênh', ...jsonBody(revenueByChannelReportSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/reports/cancellations',
    operationId: 'reportsCancellations',
    summary: 'Huỷ theo bậc chính sách kèm tỷ lệ huỷ — ACCOUNTANT (UC-REP-03, BR-REP-01)',
    tags: ['rep'],
    ...bearerRead,
    request: { query: cancellationsReportQuerySchema },
    responses: {
      200: { description: 'Báo cáo huỷ', ...jsonBody(cancellationsReportSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/reports/force-majeure',
    operationId: 'reportsForceMajeure',
    summary: 'Ca bất khả kháng — chỉ OWNER xem (UC-REP-03, BR-CANCEL-13)',
    tags: ['rep'],
    ...bearerRead,
    request: { query: forceMajeureReportQuerySchema },
    responses: {
      200: { description: 'Báo cáo bất khả kháng', ...jsonBody(forceMajeureReportSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/reports/overbooking',
    operationId: 'reportsOverbooking',
    summary: 'Ca quá tải kèm tổng chi phí xử lý (UC-REP-04, BR-OVER-15)',
    tags: ['rep'],
    ...bearerRead,
    request: { query: overbookingReportQuerySchema },
    responses: {
      200: { description: 'Báo cáo quá tải', ...jsonBody(overbookingReportSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/reports/export',
    operationId: 'reportsExport',
    summary: 'Xuất CSV/XLSX bất đồng bộ — 202 kèm tham chiếu tác vụ (NFR-COMP-04)',
    ...bearerWrite(['rep']),
    request: { body: jsonBody(reportExportRequestSchema) },
    responses: {
      202: { description: 'Đã nhận yêu cầu xuất', ...jsonBody(operationRefSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      422: errorResponse('E_GEN_VALIDATION_FAILED'),
    },
  });

  // CRM quản trị (cùng ticket HB-160): ẩn danh hoá, hạng/điểm, danh sách đen.
  // Ràng buộc âm §2.14: **không** khai `DELETE /guests/{guestId}` — chỉ ẩn danh hoá.
  registry.registerPath({
    method: 'post',
    path: '/api/v1/guests/{guestId}/anonymize',
    operationId: 'guestsAnonymize',
    summary: 'Ẩn danh hoá hồ sơ khách theo yêu cầu — MANAGER (UC-CRM-01, BR-CRM-05)',
    ...bearerWrite(['crm']),
    parameters: [...idempotencyHeaders, pathParam('guestId')],
    request: { body: jsonBody(guestAnonymizeRequestSchema) },
    responses: {
      200: { description: 'Hồ sơ đã ẩn danh hoá', ...jsonBody(guestSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/guests/{guestId}/loyalty',
    operationId: 'guestsLoyalty',
    summary: 'Hạng, điểm và số đêm tích luỹ 12 tháng (UC-CRM-02, BR-CRM-02,03)',
    tags: ['crm'],
    ...bearerRead,
    parameters: [pathParam('guestId')],
    responses: {
      200: { description: 'Hồ sơ khách hàng thân thiết', ...jsonBody(guestLoyaltySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/guests/me',
    operationId: 'guestsMe',
    summary: 'Hồ sơ của chính khách đang đăng nhập (phiên khách, UC-CRM-01, HB-105)',
    tags: ['crm'],
    ...bearerRead,
    responses: {
      200: { description: 'Hồ sơ khách', ...jsonBody(guestSummarySchema) },
      401: errorResponse('E_AUTH_INVALID_CREDENTIALS'),
      403: errorResponse('E_RBAC_FORBIDDEN'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/guests/me/loyalty',
    operationId: 'guestsMeLoyalty',
    summary: 'Hạng, điểm và số đêm tích luỹ của chính khách (phiên khách, UC-CRM-02, HB-105)',
    tags: ['crm'],
    ...bearerRead,
    responses: {
      200: { description: 'Hồ sơ khách hàng thân thiết', ...jsonBody(guestLoyaltySchema) },
      401: errorResponse('E_AUTH_INVALID_CREDENTIALS'),
      403: errorResponse('E_RBAC_FORBIDDEN'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/guests/{guestId}/blacklist',
    operationId: 'guestsBlacklistAdd',
    summary: 'Đưa khách vào danh sách đen kèm lý do — MANAGER (UC-CRM-03, BR-CRM-04)',
    ...bearerWrite(['crm']),
    parameters: [...idempotencyHeaders, pathParam('guestId')],
    request: { body: jsonBody(guestBlacklistRequestSchema) },
    responses: {
      201: { description: 'Khách đã vào danh sách đen', ...jsonBody(guestSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/guests/{guestId}/blacklist',
    operationId: 'guestsBlacklistRemove',
    summary: 'Gỡ khỏi danh sách đen kèm lý do — MANAGER (UC-CRM-03, BR-CRM-04,05)',
    ...bearerWrite(['crm']),
    parameters: [...idempotencyHeaders, pathParam('guestId')],
    request: { query: guestBlacklistReleaseQuerySchema },
    responses: {
      204: { description: 'Đã gỡ khỏi danh sách đen' },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/notifications',
    operationId: 'notificationsList',
    summary: 'Thông báo đã gửi kèm trạng thái và số lần thử — người nhận được che (BR-SYS-06)',
    tags: ['noti'],
    ...bearerRead,
    request: { query: notificationQuerySchema },
    responses: {
      200: {
        description: 'Danh sách thông báo',
        ...jsonBody(listResponseSchema(notificationSummarySchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/notifications/{notificationId}/resend',
    operationId: 'notificationsResend',
    summary: 'Gửi lại thông báo — tối đa 3 lần, cách nhau 5 phút (UC-NOTI-02, BR-SYS-06)',
    ...bearerWrite(['noti']),
    parameters: [...idempotencyHeaders, pathParam('notificationId')],
    request: { body: jsonBody(notificationResendRequestSchema) },
    responses: {
      202: { description: 'Đã xếp hàng gửi lại', ...jsonBody(notificationSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_GEN_VALIDATION_FAILED'),
    },
  });
}
