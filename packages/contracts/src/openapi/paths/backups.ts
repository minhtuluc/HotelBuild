/** Path OpenAPI sao lưu & diễn tập phục hồi (HB-179/HB-246, SCR-18). `registry.ts` gọi `registerBackupPaths`. */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import { operationRefSchema } from '../../common.js';
import { backupRequestSchema, backupStatusSchema, restoreRequestSchema } from '../../system.js';
import {
  bearerWrite,
  idempotencyHeaders,
  jsonBody,
  makeErrorResponse,
  pathParam,
} from '../shared.js';

export function registerBackupPaths(
  registry: OpenAPIRegistry,
  errorBodyComponent: z.ZodTypeAny,
): void {
  const errorResponse = makeErrorResponse(errorBodyComponent);
  registry.registerPath({
    method: 'get',
    path: '/api/v1/system/backups',
    operationId: 'systemBackupsStatus',
    summary: 'Trạng thái sao lưu: bản sao lưu trong kho, WAL archive, thao tác gần đây (SCR-18)',
    tags: ['sys'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Trạng thái sao lưu hiện tại', ...jsonBody(backupStatusSchema) },
      403: errorResponse('E_RBAC_FORBIDDEN'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/system/backups',
    operationId: 'systemBackupsCreate',
    summary:
      'Yêu cầu sao lưu — trả 202 kèm tham chiếu tác vụ; `FULL` = toàn phần, `PITR` = gia tăng trên bản full gần nhất (UC-SYS-03, BR-SYS-03)',
    ...bearerWrite(['sys']),
    request: { body: jsonBody(backupRequestSchema) },
    responses: {
      202: { description: 'Đã nhận yêu cầu sao lưu', ...jsonBody(operationRefSchema) },
      400: errorResponse('E_GEN_VALIDATION_FAILED'),
      403: errorResponse('E_RBAC_FORBIDDEN'),
      409: errorResponse('E_SYS_REQUEST_IN_PROGRESS'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/system/backups/{backupId}/restore',
    operationId: 'systemBackupsRestore',
    summary:
      'Diễn tập phục hồi vào môi trường tạm do server chọn — không nhận URL/đường dẫn CSDL (§2.14); không chạm CSDL đang chạy',
    ...bearerWrite(['sys']),
    parameters: [...idempotencyHeaders, pathParam('backupId')],
    request: { body: jsonBody(restoreRequestSchema) },
    responses: {
      202: { description: 'Đã nhận yêu cầu diễn tập', ...jsonBody(operationRefSchema) },
      400: errorResponse('E_GEN_VALIDATION_FAILED'),
      403: errorResponse('E_RBAC_FORBIDDEN'),
      404: errorResponse('E_GEN_NOT_FOUND'),
      409: errorResponse('E_SYS_REQUEST_IN_PROGRESS'),
    },
  });
}
