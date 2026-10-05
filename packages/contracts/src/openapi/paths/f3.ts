/**
 * Path OpenAPI pha F3 (RATE + gói giá + chính sách huỷ) — HB-050.
 * `registry.ts` chỉ gọi `registerF3Paths`; helper khai tại chỗ để tệp này tự chứa.
 * Ràng buộc âm (§2.14): **không** có tuyến ghi lên price snapshot.
 */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { listResponseSchema } from '../../common.js';
import {
  cancellationPolicySchema,
  cancellationPolicyUpdateRequestSchema,
} from '../../cancellation-policy.js';
import {
  channelDetailSchema,
  channelQuerySchema,
  channelSummarySchema,
  channelUpdateRequestSchema,
  multiChannelQuoteRequestSchema,
  multiChannelQuoteSchema,
  promotionCreateRequestSchema,
  promotionQuerySchema,
  promotionSummarySchema,
  rateCalendarOverrideRequestSchema,
  rateCalendarQuerySchema,
  rateCalendarSchema,
  ratePlanPublicSchema,
  ratePlanUpdateRequestSchema,
  seasonCreateRequestSchema,
  seasonQuerySchema,
  seasonSummarySchema,
} from '../../rate.js';
import type { ErrorCode } from '../../errors.js';

const jsonBody = (schema: z.ZodTypeAny) => ({
  content: { 'application/json': { schema } },
});

const idempotencyHeaders = [
  {
    name: 'Idempotency-Key',
    in: 'header' as const,
    required: true,
    schema: { type: 'string' as const, format: 'uuid' },
    description: 'Bắt buộc cho mọi lệnh ghi; hiệu lực 24 giờ (api.md §1.3).',
  },
  {
    name: 'X-Correlation-Id',
    in: 'header' as const,
    required: false,
    schema: { type: 'string' as const },
    description: 'Mã tương quan do client sinh; server tự sinh nếu thiếu (kiến trúc §9).',
  },
];

const ifMatchHeader = {
  name: 'If-Match',
  in: 'header' as const,
  required: true,
  schema: { type: 'string' as const },
  description: 'Phiên bản đọc gần nhất; thiếu → 428, lệch → 412 (api.md §1.3).',
};

const pathParam = (name: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const },
});

export function registerF3Paths(registry: OpenAPIRegistry, errorBodyComponent: z.ZodTypeAny): void {
  const errorResponse = (...codes: readonly ErrorCode[]) => ({
    description: codes.join(', '),
    content: { 'application/json': { schema: errorBodyComponent } },
  });
  const bearerRead = { security: [{ bearerAuth: [] }] };
  const bearerWrite = (tags: readonly string[]) => ({
    tags: [...tags],
    security: [{ bearerAuth: [] }],
    parameters: idempotencyHeaders,
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/room-types/{roomTypeId}/rate-calendar',
    operationId: 'rateCalendarGet',
    summary: 'Lịch giá theo ngày (UC-RATE-01, BR-RATE-02,03)',
    tags: ['rate'],
    ...bearerRead,
    parameters: [pathParam('roomTypeId')],
    request: { query: rateCalendarQuerySchema },
    responses: {
      200: { description: 'Lịch giá', ...jsonBody(rateCalendarSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/v1/room-types/{roomTypeId}/rate-calendar',
    operationId: 'rateCalendarPut',
    summary:
      'Ghi đè lịch giá (source=OVERRIDE); lệch ±20% cần OWNER xác nhận (UC-RATE-01, BR-RBAC-04)',
    ...bearerWrite(['rate']),
    parameters: [...idempotencyHeaders, pathParam('roomTypeId')],
    request: { body: jsonBody(rateCalendarOverrideRequestSchema) },
    responses: {
      200: { description: 'Lịch giá sau ghi đè', ...jsonBody(rateCalendarSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      422: errorResponse('E_RATE_BELOW_FLOOR', 'E_RATE_CONFIGURATION_INVALID'),
    },
  });

  // Bổ sung tuyến đọc (HB-059 SCR-27, chủ dự án duyệt 05/10/2026): api.md §2.4 chỉ có POST /seasons
  // nên màn hình không liệt kê được mùa hiện có. Thay đổi tương thích (thêm tuyến), 0 phá vỡ.
  registry.registerPath({
    method: 'get',
    path: '/api/v1/seasons',
    operationId: 'seasonsList',
    summary: 'Danh sách mùa của cơ sở kèm hệ số, ưu tiên, phụ thu cuối tuần và phiên bản (SCR-27)',
    tags: ['rate'],
    ...bearerRead,
    request: { query: seasonQuerySchema },
    responses: {
      200: { description: 'Danh sách mùa', ...jsonBody(listResponseSchema(seasonSummarySchema)) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/seasons',
    operationId: 'seasonsCreate',
    summary: 'Tạo mùa: hệ số, ưu tiên, phụ thu cuối tuần (UC-RATE-02, BR-RATE-05,06)',
    ...bearerWrite(['rate']),
    request: { body: jsonBody(seasonCreateRequestSchema) },
    responses: {
      201: { description: 'Mùa đã tạo' },
      403: errorResponse('E_RBAC_FORBIDDEN'),
      422: errorResponse('E_RATE_CONFIGURATION_INVALID'),
    },
  });

  // Bổ sung tuyến đọc kênh (HB-060/HB-042, chủ dự án duyệt 05/10/2026): api.md chỉ có PATCH theo
  // `{channelId}` nên SCR-28/SCR-25 không dựng được danh sách kênh. Thêm tuyến, 0 phá vỡ.
  registry.registerPath({
    method: 'get',
    path: '/api/v1/channels',
    operationId: 'channelsList',
    summary: 'Danh sách kênh kèm hệ số, hoa hồng, hold, cờ bán vượt và phiên bản (SCR-25, SCR-28)',
    tags: ['rate'],
    ...bearerRead,
    request: { query: channelQuerySchema },
    responses: {
      200: {
        description: 'Danh sách kênh',
        ...jsonBody(listResponseSchema(channelSummarySchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/channels/{channelId}',
    operationId: 'channelsGet',
    summary: 'Chi tiết kênh kèm các dòng ghi đè theo cơ sở (SCR-28, BR-RATE-18)',
    tags: ['rate'],
    ...bearerRead,
    parameters: [pathParam('channelId')],
    responses: {
      200: { description: 'Chi tiết kênh', ...jsonBody(channelDetailSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/channels/{channelId}',
    operationId: 'channelsUpdate',
    summary:
      'Sửa hệ số/hoa hồng/hold mặc định toàn chuỗi + ghi đè theo cơ sở (UC-RATE-03, BR-RATE-07,09,18)',
    ...bearerWrite(['rate']),
    parameters: [...idempotencyHeaders, pathParam('channelId'), ifMatchHeader],
    request: { body: jsonBody(channelUpdateRequestSchema) },
    responses: {
      204: { description: 'Đã cập nhật kênh' },
      403: errorResponse('E_RBAC_FORBIDDEN'),
      412: errorResponse('E_GEN_VERSION_CONFLICT'),
      422: errorResponse('E_RATE_BELOW_FLOOR'),
      428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
    },
  });

  // Bổ sung tuyến đọc khuyến mãi (HB-061 SCR-29, chủ dự án duyệt 05/10/2026). Thêm tuyến, 0 phá vỡ.
  registry.registerPath({
    method: 'get',
    path: '/api/v1/promotions',
    operationId: 'promotionsList',
    summary: 'Danh sách khuyến mãi kèm lượt đã dùng, phạm vi và trạng thái (SCR-29)',
    tags: ['rate'],
    ...bearerRead,
    request: { query: promotionQuerySchema },
    responses: {
      200: {
        description: 'Danh sách khuyến mãi',
        ...jsonBody(listResponseSchema(promotionSummarySchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/promotions',
    operationId: 'promotionsCreate',
    summary: 'Tạo khuyến mãi (UC-RATE-04, BR-RATE-10,11,13)',
    ...bearerWrite(['rate']),
    request: { body: jsonBody(promotionCreateRequestSchema) },
    responses: {
      201: { description: 'Khuyến mãi đã tạo' },
      403: errorResponse('E_RBAC_FORBIDDEN'),
      422: errorResponse('E_RATE_PROMO_INVALID'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/quotes/multi-channel',
    operationId: 'quotesMultiChannel',
    summary: 'So sánh giá đồng thời nhiều kênh (UC-RATE-05, BR-RATE-07,08,09)',
    ...bearerWrite(['rate']),
    request: { body: jsonBody(multiChannelQuoteRequestSchema) },
    responses: {
      200: { description: 'Báo giá theo từng kênh', ...jsonBody(multiChannelQuoteSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      409: errorResponse('E_RATE_QUOTE_MISMATCH'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/rate-plans',
    operationId: 'ratePlansList',
    summary: 'Gói giá đang bán và điều khoản cho khách — không lộ cấu hình nội bộ (UC-RATE-06)',
    tags: ['rate'],
    // Công khai theo api.md §2.4 (vai trò "—"): khách xem gói trước khi đăng nhập ở journey F4.
    request: {
      query: z.object({
        propertyId: z.string().min(1).optional(),
        checkIn: z.string().optional(),
        checkOut: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Danh sách gói giá',
        ...jsonBody(listResponseSchema(ratePlanPublicSchema)),
      },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/v1/rate-plans/{ratePlanId}',
    operationId: 'ratePlansUpdate',
    summary:
      'Cập nhật cấu hình gói giá cho báo giá mới, giữ nguyên snapshot đã bán (UC-RATE-06, BR-RATE-16)',
    ...bearerWrite(['rate']),
    parameters: [...idempotencyHeaders, pathParam('ratePlanId'), ifMatchHeader],
    request: { body: jsonBody(ratePlanUpdateRequestSchema) },
    responses: {
      204: { description: 'Đã cập nhật gói giá' },
      403: errorResponse('E_RBAC_FORBIDDEN'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      412: errorResponse('E_GEN_VERSION_CONFLICT'),
      428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/cancellation-policies',
    operationId: 'cancellationPoliciesList',
    summary: 'Chính sách huỷ và toàn bộ bậc kèm version (UC-RATE-06, BR-CANCEL-01,02)',
    tags: ['rate'],
    ...bearerRead,
    request: { query: z.object({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }) },
    responses: {
      200: {
        description: 'Danh sách chính sách',
        ...jsonBody(listResponseSchema(cancellationPolicySchema)),
      },
      403: errorResponse('E_RBAC_FORBIDDEN'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/v1/cancellation-policies/{policyId}',
    operationId: 'cancellationPoliciesUpdate',
    summary:
      'Thay toàn bộ bậc trong một transaction; validate mốc/phần trăm/catch-all (UC-RATE-06, BR-CANCEL-01,02,09)',
    ...bearerWrite(['rate']),
    parameters: [...idempotencyHeaders, pathParam('policyId'), ifMatchHeader],
    request: { body: jsonBody(cancellationPolicyUpdateRequestSchema) },
    responses: {
      200: { description: 'Chính sách sau cập nhật', ...jsonBody(cancellationPolicySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN'),
      412: errorResponse('E_GEN_VERSION_CONFLICT'),
      422: errorResponse('E_RATE_CONFIGURATION_INVALID'),
      428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
    },
  });
}
