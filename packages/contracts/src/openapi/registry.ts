/**
 * Sổ đăng ký OpenAPI 3.1 — nguồn: docs/04-thiet-ke/api.md §2 (AUTH + system/health).
 * F0 chỉ đăng ký phần hợp đồng mà F1 cần; các pha sau bổ sung theo module của mình.
 */
import './zod-openapi.js';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import {
  guestLoginRequestSchema,
  guestRegisterRequestSchema,
  loginRequestSchema,
  pinTokenSchema,
  pinVerifyRequestSchema,
  refreshRequestSchema,
  tokenPairSchema,
  userAccessUpdateRequestSchema,
} from '../auth.js';
import { errorBodySchema } from '../common.js';
import type { ErrorCode } from '../errors.js';

export const registry = new OpenAPIRegistry();

/** Thành phần dùng chung tham chiếu từ mọi phản hồi lỗi. */
const errorBodyComponent = registry.register('ErrorBody', errorBodySchema);

const jsonBody = (schema: z.ZodTypeAny) => ({
  content: { 'application/json': { schema } },
});

/** Phản hồi lỗi dùng chung: mã lấy đúng từ danh mục §4.2 nên không thể lệch tài liệu. */
export function errorResponse(code: ErrorCode) {
  return {
    description: code,
    content: { 'application/json': { schema: errorBodyComponent } },
  };
}

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

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/login',
  operationId: 'authLogin',
  summary: 'Đăng nhập nội bộ — trả cặp access/refresh (UC-AUTH-01)',
  tags: ['auth'],
  parameters: idempotencyHeaders,
  request: { body: jsonBody(loginRequestSchema) },
  responses: {
    200: { description: 'Cặp token', ...jsonBody(tokenPairSchema) },
    400: errorResponse('E_GEN_VALIDATION_FAILED'),
    401: errorResponse('E_AUTH_INVALID_CREDENTIALS'),
    503: errorResponse('E_GEN_SERVICE_UNAVAILABLE'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/refresh',
  operationId: 'authRefresh',
  summary: 'Luân chuyển refresh token; dùng lại token cũ thu hồi cả họ (UC-AUTH-01)',
  tags: ['auth'],
  parameters: idempotencyHeaders,
  request: { body: jsonBody(refreshRequestSchema) },
  responses: {
    200: { description: 'Cặp token mới', ...jsonBody(tokenPairSchema) },
    401: errorResponse('E_AUTH_INVALID_CREDENTIALS'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/pin/verify',
  operationId: 'authPinVerify',
  summary: 'Xác minh PIN 6 số cho thao tác tài chính, trả pinToken dùng một lần (BR-RBAC-05)',
  tags: ['auth'],
  security: [{ bearerAuth: [] }],
  parameters: idempotencyHeaders,
  request: { body: jsonBody(pinVerifyRequestSchema) },
  responses: {
    200: { description: 'pinToken', ...jsonBody(pinTokenSchema) },
    401: errorResponse('E_AUTH_PIN_REQUIRED'),
    403: errorResponse('E_RBAC_FORBIDDEN'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout',
  operationId: 'authLogout',
  summary: 'Thu hồi phiên và họ refresh token (UC-AUTH-01)',
  tags: ['auth'],
  security: [{ bearerAuth: [] }],
  parameters: idempotencyHeaders,
  responses: {
    204: { description: 'Đã thu hồi phiên' },
    401: errorResponse('E_AUTH_INVALID_CREDENTIALS'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/guest-auth/register',
  operationId: 'guestRegister',
  summary: 'Khách tự đăng ký; nhận diện duy nhất theo số điện thoại chuẩn hoá (UC-AUTH-03)',
  tags: ['auth'],
  parameters: idempotencyHeaders,
  request: { body: jsonBody(guestRegisterRequestSchema) },
  responses: {
    201: { description: 'Hồ sơ khách đã tạo', ...jsonBody(tokenPairSchema) },
    422: errorResponse('E_CRM_PHONE_INVALID'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/guest-auth/login',
  operationId: 'guestLogin',
  summary: 'Khách đăng nhập (UC-AUTH-03)',
  tags: ['auth'],
  parameters: idempotencyHeaders,
  request: { body: jsonBody(guestLoginRequestSchema) },
  responses: {
    200: { description: 'Cặp token khách', ...jsonBody(tokenPairSchema) },
    401: errorResponse('E_AUTH_INVALID_CREDENTIALS'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/guest-auth/refresh',
  operationId: 'guestRefresh',
  summary: 'Luân chuyển refresh token khách; dùng lại token cũ thu hồi cả họ (UC-AUTH-03)',
  tags: ['auth'],
  parameters: idempotencyHeaders,
  request: { body: jsonBody(refreshRequestSchema) },
  responses: {
    200: { description: 'Cặp token khách mới', ...jsonBody(tokenPairSchema) },
    401: errorResponse('E_AUTH_INVALID_CREDENTIALS'),
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/users/{userId}/access',
  operationId: 'usersAccessUpdate',
  summary: 'Gán vai trò/phạm vi cơ sở/trạng thái người dùng (UC-AUTH-02, BR-RBAC-01/02)',
  tags: ['auth'],
  security: [{ bearerAuth: [] }],
  parameters: [
    ...idempotencyHeaders,
    { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
    {
      name: 'If-Match',
      in: 'header',
      required: true,
      schema: { type: 'string' },
      description: 'Phiên bản cấu hình; thiếu → 428, lệch → 412 (api.md §1.6).',
    },
  ],
  request: { body: jsonBody(userAccessUpdateRequestSchema) },
  responses: {
    200: { description: 'Người dùng đã cập nhật' },
    403: errorResponse('E_RBAC_FORBIDDEN'),
    404: errorResponse('E_GEN_NOT_FOUND'),
    412: errorResponse('E_GEN_VERSION_CONFLICT'),
    428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/system/health',
  operationId: 'systemHealth',
  summary: 'Kiểm tra sống; chỉ trả {status:"ok"} (api.md §2, SYS)',
  tags: ['system'],
  responses: {
    200: { description: 'Dịch vụ sống' },
    503: errorResponse('E_GEN_SERVICE_UNAVAILABLE'),
  },
});
