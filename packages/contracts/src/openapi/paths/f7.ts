/**
 * Path OpenAPI pha F7 (tiền sảnh, buồng phòng, khách tại quầy, chốt đối soát) — HB-140.
 * Lệnh 🔒 (check-out, chốt đối soát) khai `pinToken` trong body theo QĐ-01 mục 6. `PATCH` task có
 * `If-Match`; **không** khai tuyến loyalty/blacklist/anonymize (thuộc hợp đồng F8 — HB-160).
 */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import { listResponseSchema } from '../../common.js';
import {
  checkInRequestSchema,
  checkInResponseSchema,
  checkOutRequestSchema,
  checkOutResponseSchema,
  noShowRequestSchema,
  noShowResponseSchema,
} from '../../front-office.js';
import {
  housekeepingTaskQuerySchema,
  housekeepingTaskSchema,
  housekeepingTaskUpdateRequestSchema,
} from '../../housekeeping.js';
import { guestCreateRequestSchema, guestQuerySchema, guestSummarySchema } from '../../guest.js';
import {
  reconciliationCloseRequestSchema,
  reconciliationCloseResponseSchema,
} from '../../reconciliation.js';
import {
  bearerWrite,
  idempotencyHeaders,
  ifMatchHeader,
  jsonBody,
  makeErrorResponse,
  pathParam,
} from '../shared.js';

export function registerF7Paths(registry: OpenAPIRegistry, errorBodyComponent: z.ZodTypeAny): void {
  const errorResponse = makeErrorResponse(errorBodyComponent);
  const bearerRead = { security: [{ bearerAuth: [] }] };

  registry.registerPath({
    method: 'post',
    path: '/api/v1/front-office/check-in',
    operationId: 'frontOfficeCheckIn',
    summary: 'Check-in: gán phòng thực tế, chặn khi nợ vượt ngưỡng (UC-FO-01, BR-FO-01,02,04)',
    ...bearerWrite(['fo']),
    request: { body: jsonBody(checkInRequestSchema) },
    responses: {
      201: { description: 'Đã check-in', ...jsonBody(checkInResponseSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE', 'E_BOOK_BLACKLISTED'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_FO_CHECKIN_NOT_ALLOWED', 'E_BOOK_INVALID_STATE'),
      422: errorResponse('E_BOOK_OVER_CAPACITY'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/front-office/check-out',
    operationId: 'frontOfficeCheckOut',
    summary: 'Check-out — 🔒 PIN; thu phát sinh, phụ thu trả muộn/sớm (UC-FO-02, BR-FO-03,05,06)',
    ...bearerWrite(['fo']),
    request: { body: jsonBody(checkOutRequestSchema) },
    responses: {
      200: { description: 'Đã check-out', ...jsonBody(checkOutResponseSchema) },
      401: errorResponse('E_AUTH_PIN_REQUIRED'),
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_BOOK_INVALID_STATE'),
      422: errorResponse('E_PAY_AMOUNT_MISMATCH'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/front-office/no-show',
    operationId: 'frontOfficeNoShow',
    summary: 'Ghi nhận khách không đến, áp bậc bắt tất của chính sách (UC-FO-04, BR-CANCEL-10)',
    ...bearerWrite(['fo']),
    request: { body: jsonBody(noShowRequestSchema) },
    responses: {
      200: { description: 'Đã đánh dấu no-show', ...jsonBody(noShowResponseSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_BOOK_INVALID_STATE'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/housekeeping/tasks',
    operationId: 'housekeepingTasksList',
    summary: 'Danh sách việc dọn phòng — projection tối thiểu (UC-FO-03, BR-FO-06, BR-RBAC-03)',
    tags: ['fo'],
    ...bearerRead,
    request: { query: housekeepingTaskQuerySchema },
    responses: {
      200: {
        description: 'Nhiệm vụ buồng phòng (không kèm booking/khách/tiền)',
        ...jsonBody(listResponseSchema(housekeepingTaskSchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/housekeeping/tasks/{taskId}',
    operationId: 'housekeepingTasksUpdate',
    summary: 'Cập nhật việc được giao; `assignedTo` chỉ FRONT_DESK/MANAGER (UC-FO-03, BR-FO-06,07)',
    ...bearerWrite(['fo']),
    parameters: [...idempotencyHeaders, pathParam('taskId'), ifMatchHeader],
    request: { body: jsonBody(housekeepingTaskUpdateRequestSchema) },
    responses: {
      200: { description: 'Nhiệm vụ sau cập nhật', ...jsonBody(housekeepingTaskSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_FO_TASK_TRANSITION_NOT_ALLOWED', 'E_SYS_REQUEST_IN_PROGRESS'),
      412: errorResponse('E_GEN_VERSION_CONFLICT'),
      428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/guests',
    operationId: 'guestsList',
    summary: 'Tra cứu hồ sơ khách tại quầy (UC-CRM-01, BR-CRM-01)',
    tags: ['crm'],
    ...bearerRead,
    request: { query: guestQuerySchema },
    responses: {
      200: { description: 'Danh sách khách', ...jsonBody(listResponseSchema(guestSummarySchema)) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/guests',
    operationId: 'guestsCreate',
    summary: 'Tạo hồ sơ khách theo SĐT chuẩn hoá (UC-CRM-01, BR-CRM-01, NFR-COMP-01)',
    ...bearerWrite(['crm']),
    request: { body: jsonBody(guestCreateRequestSchema) },
    responses: {
      201: { description: 'Hồ sơ khách', ...jsonBody(guestSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      409: errorResponse('E_AUTH_PHONE_REGISTERED'),
      422: errorResponse('E_CRM_PHONE_INVALID'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/reconciliation/daily/close',
    operationId: 'reconciliationDailyClose',
    summary: 'Chốt ca/ngày theo (người thu, ngày VN) — 🔒 PIN (UC-PAY-05, BR-PAY-06,10)',
    ...bearerWrite(['pay']),
    request: { body: jsonBody(reconciliationCloseRequestSchema) },
    responses: {
      201: { description: 'Đã chốt đối soát', ...jsonBody(reconciliationCloseResponseSchema) },
      401: errorResponse('E_AUTH_PIN_REQUIRED'),
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      409: errorResponse('E_SYS_IDEMPOTENCY_KEY_REUSED'),
    },
  });
}
