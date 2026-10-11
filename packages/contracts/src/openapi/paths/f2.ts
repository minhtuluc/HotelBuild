/**
 * Path OpenAPI pha F2 (PROP/INV/SYS) — HB-030. `registry.ts` chỉ gọi `registerF2Paths`.
 * Ràng buộc âm (§2.14): không khai `PUT/PATCH/DELETE /audit-logs/**`, không có tuyến ghi price snapshot,
 * `restore` không nhận URL/đường dẫn CSDL.
 */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  businessDateSchema,
  listResponseSchema,
  operationRefSchema,
  operationStatusViewSchema,
} from '../../common.js';
import {
  allotmentPutRequestSchema,
  allotmentQuerySchema,
  allotmentRowSchema,
  inventoryGridQuerySchema,
  inventoryGridSchema,
} from '../../inventory.js';
import {
  connectingRoomRequestSchema,
  propertyPublicSummarySchema,
  propertySummarySchema,
  propertyUpdateRequestSchema,
  roomBlockCreateRequestSchema,
  roomBlockSchema,
  roomSummarySchema,
  roomTypeCreateRequestSchema,
  roomTypeSummarySchema,
} from '../../property.js';
import {
  auditLogEntrySchema,
  auditLogQuerySchema,
  backupRequestSchema,
  restoreRequestSchema,
  systemSettingQuerySchema,
  systemSettingSchema,
  systemSettingUpdateRequestSchema,
} from '../../system.js';
import {
  bearerWrite,
  ifMatchHeader,
  idempotencyHeaders,
  jsonBody,
  makeErrorResponse,
  pathParam,
} from '../shared.js';

export function registerF2Paths(registry: OpenAPIRegistry, errorBodyComponent: z.ZodTypeAny): void {
  const errorResponse = makeErrorResponse(errorBodyComponent);
  const bearerRead = { security: [{ bearerAuth: [] }] };

  registry.registerPath({
    method: 'get',
    path: '/api/v1/properties',
    operationId: 'propertiesList',
    summary: 'Danh sách cơ sở kèm số phòng ACTIVE (UC-PROP-01)',
    tags: ['prop'],
    ...bearerRead,
    request: { query: z.object({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }) },
    responses: {
      200: {
        description: 'Danh sách cơ sở',
        ...jsonBody(listResponseSchema(propertySummarySchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/public/properties',
    operationId: 'publicPropertiesList',
    summary: 'Danh sách cơ sở cho journey khách — chỉ trường công khai (UC-INV-02)',
    tags: ['prop'],
    // Công khai: khách chọn cơ sở trước khi đăng nhập/giữ chỗ; không lộ cờ nội bộ.
    responses: {
      200: {
        description: 'Danh sách cơ sở công khai',
        ...jsonBody(listResponseSchema(propertyPublicSummarySchema)),
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/properties/{propertyId}',
    operationId: 'propertiesUpdate',
    summary: 'Sửa cơ sở: trần bán vượt, giờ nhận/trả (UC-PROP-01, BR-OVER-01,02)',
    ...bearerWrite(['prop']),
    parameters: [...idempotencyHeaders, pathParam('propertyId'), ifMatchHeader],
    request: { body: jsonBody(propertyUpdateRequestSchema) },
    responses: {
      200: { description: 'Cơ sở đã cập nhật', ...jsonBody(propertySummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      412: errorResponse('E_GEN_VERSION_CONFLICT'),
      428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/room-types',
    operationId: 'roomTypesCreate',
    summary: 'Tạo loại phòng: sức chứa, giá cơ bản, sàn/trần (UC-PROP-02, BR-RATE-03,04)',
    ...bearerWrite(['prop']),
    request: { body: jsonBody(roomTypeCreateRequestSchema) },
    responses: {
      201: { description: 'Loại phòng đã tạo', ...jsonBody(roomTypeSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      422: errorResponse('E_RATE_CONFIGURATION_INVALID'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/room-types',
    operationId: 'roomTypesList',
    summary: 'Danh sách loại phòng kèm sức chứa và sàn–trần giá (UC-PROP-02, SCR-20)',
    tags: ['prop'],
    ...bearerRead,
    request: { query: z.object({ propertyId: z.string().min(1).optional() }) },
    responses: {
      200: {
        description: 'Danh sách loại phòng',
        ...jsonBody(listResponseSchema(roomTypeSummarySchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/rooms',
    operationId: 'roomsList',
    summary: 'Danh sách phòng vật lý (UC-PROP-03)',
    tags: ['prop'],
    ...bearerRead,
    request: {
      query: z.object({
        propertyId: z.string().min(1).optional(),
        roomTypeId: z.string().min(1).optional(),
        status: z.enum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']).optional(),
      }),
    },
    responses: {
      200: { description: 'Danh sách phòng', ...jsonBody(listResponseSchema(roomSummarySchema)) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/v1/rooms/{roomId}/connecting-room',
    operationId: 'roomsSetConnecting',
    summary: 'Gán/gỡ phòng thông nhau, đối xứng hai chiều (UC-PROP-03, BR-OVER-15)',
    ...bearerWrite(['prop']),
    parameters: [...idempotencyHeaders, pathParam('roomId'), ifMatchHeader],
    request: { body: jsonBody(connectingRoomRequestSchema) },
    responses: {
      200: { description: 'Phòng đã cập nhật', ...jsonBody(roomSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      412: errorResponse('E_GEN_VERSION_CONFLICT'),
    },
  });

  // Bổ sung tuyến đọc (HB-039, QĐ-04 mục 7): api.md §2.2 chỉ có POST/DELETE nên SCR-22 không liệt kê
  // được khoá đang có và không cảnh báo chồng lấn. Thay đổi tương thích (thêm tuyến), 0 phá vỡ.
  registry.registerPath({
    method: 'get',
    path: '/api/v1/room-blocks',
    operationId: 'roomBlocksList',
    summary: 'Danh sách khoá phòng đang có để SCR-22 liệt kê và cảnh báo chồng lấn (UC-PROP-04)',
    tags: ['prop'],
    ...bearerRead,
    request: {
      query: z.object({
        propertyId: z.string().min(1).optional(),
        roomId: z.string().min(1).optional(),
        from: businessDateSchema.optional(),
        to: businessDateSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).optional(),
      }),
    },
    responses: {
      200: {
        description: 'Danh sách khoá phòng',
        ...jsonBody(listResponseSchema(roomBlockSchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/room-blocks',
    operationId: 'roomBlocksCreate',
    summary: 'Khoá phòng/ngừng bán — tồn giảm ngay (UC-PROP-04, BR-INV-06, BR-PROP-06)',
    ...bearerWrite(['prop']),
    request: { body: jsonBody(roomBlockCreateRequestSchema) },
    responses: {
      201: { description: 'Khoá phòng đã tạo', ...jsonBody(roomBlockSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN'),
      409: errorResponse('E_INV_NO_AVAILABILITY'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/room-blocks/{roomBlockId}',
    operationId: 'roomBlocksDelete',
    summary: 'Gỡ khoá phòng (UC-PROP-04, BR-INV-06)',
    ...bearerWrite(['prop']),
    parameters: [
      ...idempotencyHeaders,
      pathParam('roomBlockId'),
      { name: 'reason', in: 'query', required: true, schema: { type: 'string' } },
    ],
    responses: {
      204: { description: 'Đã gỡ khoá' },
      403: errorResponse('E_RBAC_FORBIDDEN'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/inventory/grid',
    operationId: 'inventoryGrid',
    summary: 'Lưới tồn ngày × loại phòng, tối đa 31 ngày (UC-INV-01, NFR-PERF-05)',
    tags: ['inv'],
    ...bearerRead,
    request: { query: inventoryGridQuerySchema },
    responses: {
      200: {
        description: 'Lưới tồn; không lọc loại phòng trả grids và root là loại đầu theo code/id',
        ...jsonBody(inventoryGridSchema),
      },
      404: errorResponse('E_GEN_NOT_FOUND'),
      400: errorResponse('E_GEN_VALIDATION_FAILED'),
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  const allotmentETag = {
    ETag: {
      description:
        'Phiên bản cấu hình toàn bộ cặp channelId × roomTypeId, kể cả ngày ngoài khoảng đọc; không lấy MAX phiên bản dòng.',
      schema: { type: 'string' as const },
    },
  };
  registry.registerPath({
    method: 'get',
    path: '/api/v1/channel-allotments',
    operationId: 'allotmentsList',
    summary: 'Allotment theo kênh × loại phòng × ngày (UC-INV-03, BR-INV-05)',
    tags: ['inv'],
    ...bearerRead,
    request: { query: allotmentQuerySchema },
    responses: {
      200: {
        description: 'Danh sách allotment',
        headers: allotmentETag,
        ...jsonBody(listResponseSchema(allotmentRowSchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/v1/channel-allotments',
    operationId: 'allotmentsPut',
    summary: 'Đặt lại allotment theo lô trong một transaction (UC-INV-03, BR-INV-05, BR-CHAN-06)',
    ...bearerWrite(['inv']),
    parameters: [...idempotencyHeaders, ifMatchHeader],
    request: { body: jsonBody(allotmentPutRequestSchema) },
    responses: {
      204: { description: 'Đã cập nhật lô allotment', headers: allotmentETag },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      409: errorResponse('E_INV_LOCK_TIMEOUT', 'E_INV_ALLOTMENT_EXCEEDS_ROOMS'),
      412: errorResponse('E_GEN_VERSION_CONFLICT'),
      428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/audit-logs',
    operationId: 'auditLogsList',
    summary: 'Nhật ký kiểm toán — chỉ đọc (UC-SYS-01, BR-SYS-01)',
    tags: ['sys'],
    ...bearerRead,
    request: { query: auditLogQuerySchema },
    responses: {
      200: {
        description: 'Nhật ký kiểm toán',
        ...jsonBody(listResponseSchema(auditLogEntrySchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN'),
    },
  });

  // Bổ sung tuyến đọc tham số (HB-044 SCR-17, chủ dự án duyệt 05/10/2026): api.md §2.13 chỉ có PUT
  // nên màn hình không biết giá trị hiện tại/kiểu/phiên bản. Thay đổi tương thích (thêm tuyến).
  registry.registerPath({
    method: 'get',
    path: '/api/v1/system-settings',
    operationId: 'systemSettingsList',
    summary:
      'Danh sách tham số hệ thống kèm kiểu giá trị, người sửa cuối và phiên bản (SCR-17, BR-SYS-02)',
    tags: ['sys'],
    ...bearerRead,
    request: { query: systemSettingQuerySchema },
    responses: {
      200: {
        description: 'Danh sách tham số',
        ...jsonBody(listResponseSchema(systemSettingSchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/v1/system-settings/{key}',
    operationId: 'systemSettingsUpdate',
    summary:
      'Sửa tham số hệ thống kèm lý do, ghi AuditLog cùng transaction (UC-SYS-02, BR-SYS-02, BR-GEN-07)',
    ...bearerWrite(['sys']),
    parameters: [...idempotencyHeaders, pathParam('key'), ifMatchHeader],
    request: { body: jsonBody(systemSettingUpdateRequestSchema) },
    responses: {
      204: { description: 'Đã cập nhật tham số' },
      403: errorResponse('E_RBAC_FORBIDDEN'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      412: errorResponse('E_GEN_VERSION_CONFLICT'),
      428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/system/backups',
    operationId: 'systemBackupsCreate',
    summary: 'Yêu cầu sao lưu — trả 202 kèm tham chiếu tác vụ (UC-SYS-03, BR-SYS-03)',
    ...bearerWrite(['sys']),
    request: { body: jsonBody(backupRequestSchema) },
    responses: {
      202: { description: 'Đã nhận yêu cầu sao lưu', ...jsonBody(operationRefSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/system/backups/{backupId}/restore',
    operationId: 'systemBackupsRestore',
    summary: 'Diễn tập phục hồi vào môi trường tạm — không nhận URL/đường dẫn CSDL (§2.14)',
    ...bearerWrite(['sys']),
    parameters: [...idempotencyHeaders, pathParam('backupId')],
    request: { body: jsonBody(restoreRequestSchema) },
    responses: {
      202: { description: 'Đã nhận yêu cầu phục hồi', ...jsonBody(operationRefSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/operations/{operationId}',
    operationId: 'operationsGet',
    summary: 'Theo dõi tác vụ bất đồng bộ (api.md §6)',
    tags: ['sys'],
    ...bearerRead,
    parameters: [pathParam('operationId')],
    responses: {
      200: { description: 'Trạng thái tác vụ', ...jsonBody(operationStatusViewSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });
}
