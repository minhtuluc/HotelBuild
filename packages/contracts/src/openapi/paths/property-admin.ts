/** HB033 compatible additions, extracted to keep F2 paths within source size limit. */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import {
  roomTypeSummarySchema,
  roomTypeUpdateRequestSchema,
  roomCreateRequestSchema,
  roomUpdateRequestSchema,
  roomSummarySchema,
} from '../../property.js';
import {
  bearerWrite,
  idempotencyHeaders,
  pathParam,
  ifMatchHeader,
  jsonBody,
  makeErrorResponse,
} from '../shared.js';
export function registerPropertyAdminPaths(registry: OpenAPIRegistry, errorBody: z.ZodTypeAny) {
  const errorResponse = makeErrorResponse(errorBody);
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/room-types/{roomTypeId}',
    operationId: 'roomTypesUpdate',
    summary: 'Sửa loại phòng (HB033)',
    ...bearerWrite(['prop']),
    parameters: [...idempotencyHeaders, pathParam('roomTypeId'), ifMatchHeader],
    request: { body: jsonBody(roomTypeUpdateRequestSchema) },
    responses: {
      200: { description: 'Loại phòng cập nhật', ...jsonBody(roomTypeSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      412: errorResponse('E_GEN_VERSION_CONFLICT'),
      428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
      422: errorResponse('E_RATE_CONFIGURATION_INVALID'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/rooms',
    operationId: 'roomsCreate',
    summary: 'Tạo phòng vật lý (HB033)',
    ...bearerWrite(['prop']),
    request: { body: jsonBody(roomCreateRequestSchema) },
    responses: {
      201: { description: 'Phòng mới', ...jsonBody(roomSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_PROP_CODE_TAKEN'),
      400: errorResponse('E_GEN_VALIDATION_FAILED'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/rooms/{roomId}',
    operationId: 'roomsUpdate',
    summary: 'Sửa phòng vật lý (HB033)',
    ...bearerWrite(['prop']),
    parameters: [...idempotencyHeaders, pathParam('roomId'), ifMatchHeader],
    request: { body: jsonBody(roomUpdateRequestSchema) },
    responses: {
      200: { description: 'Phòng cập nhật', ...jsonBody(roomSummarySchema) },
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      412: errorResponse('E_GEN_VERSION_CONFLICT'),
      428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
    },
  });
}
