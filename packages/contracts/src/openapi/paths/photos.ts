/** Path OpenAPI của ảnh công khai (HB-244, yêu cầu frontend #5). `registry.ts` gọi `registerPhotoPaths`. */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import {
  photoListSchema,
  photoReplaceRequestSchema,
  roomTypePublicSchema,
} from '../../property.js';
import {
  bearerWrite,
  idempotencyHeaders,
  ifMatchHeader,
  jsonBody,
  makeErrorResponse,
  pathParam,
} from '../shared.js';

export function registerPhotoPaths(
  registry: OpenAPIRegistry,
  errorBodyComponent: z.ZodTypeAny,
): void {
  const errorResponse = makeErrorResponse(errorBodyComponent);
  const bearerRead = { security: [{ bearerAuth: [] }] };
  for (const [owner, param, label] of [
    ['properties', 'propertyId', 'cơ sở'],
    ['room-types', 'roomTypeId', 'loại phòng'],
  ] as const) {
    const id = owner === 'properties' ? 'Property' : 'RoomType';
    registry.registerPath({
      method: 'get',
      path: `/api/v1/${owner}/{${param}}/photos`,
      operationId: `photos${id}List`,
      summary: `Ảnh công khai của ${label} kèm ETag để thay (HB-244)`,
      tags: ['prop'],
      ...bearerRead,
      parameters: [pathParam(param)],
      responses: {
        200: { description: 'Danh sách ảnh theo thứ tự + ETag', ...jsonBody(photoListSchema) },
        403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
        404: errorResponse('E_GEN_NOT_FOUND'),
      },
    });
    registry.registerPath({
      method: 'put',
      path: `/api/v1/${owner}/{${param}}/photos`,
      operationId: `photos${id}Replace`,
      summary: `Thay cả danh sách ảnh của ${label} — OWNER, \`If-Match\` = ETag (HB-244)`,
      ...bearerWrite(['prop']),
      parameters: [...idempotencyHeaders, pathParam(param), ifMatchHeader],
      request: { body: jsonBody(photoReplaceRequestSchema) },
      responses: {
        204: { description: 'Đã thay danh sách ảnh' },
        400: errorResponse('E_GEN_VALIDATION_FAILED'),
        403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
        404: errorResponse('E_GEN_NOT_FOUND'),
        412: errorResponse('E_GEN_VERSION_CONFLICT'),
        428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
      },
    });
  }
  registry.registerPath({
    method: 'get',
    path: '/api/v1/public/room-types/{roomTypeId}',
    operationId: 'publicRoomType',
    summary:
      'Thông tin công khai của một loại phòng kèm ảnh cho SCR-03 — chỉ loại ACTIVE của cơ sở ACTIVE (HB-244)',
    tags: ['prop'],
    parameters: [pathParam('roomTypeId')],
    responses: {
      200: { description: 'Loại phòng công khai', ...jsonBody(roomTypePublicSchema) },
      400: errorResponse('E_GEN_VALIDATION_FAILED'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });
}
