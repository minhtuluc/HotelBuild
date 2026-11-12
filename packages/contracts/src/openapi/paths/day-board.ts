/** Path OpenAPI của bảng điều khiển ngày SCR-23 (HB-242, TD-09). `registry.ts` gọi `registerDayBoardPaths`. */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import { dayBoardQuerySchema, dayBoardSchema } from '../../day-board.js';
import { jsonBody, makeErrorResponse } from '../shared.js';

export function registerDayBoardPaths(
  registry: OpenAPIRegistry,
  errorBodyComponent: z.ZodTypeAny,
): void {
  const errorResponse = makeErrorResponse(errorBodyComponent);
  registry.registerPath({
    method: 'get',
    path: '/api/v1/operations/day-board',
    operationId: 'operationsDayBoard',
    summary:
      'Bảng điều khiển ngày: khách đến/đi/ở, ca quá tải mở, kênh DEGRADED của một cơ sở (SCR-23, TD-09)',
    tags: ['inv'],
    security: [{ bearerAuth: [] }],
    request: { query: dayBoardQuerySchema },
    responses: {
      200: {
        description: 'Ảnh chụp một cơ sở × một ngày nghiệp vụ VN',
        ...jsonBody(dayBoardSchema),
      },
      400: errorResponse('E_GEN_VALIDATION_FAILED'),
      403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
      404: errorResponse('E_GEN_NOT_FOUND'),
    },
  });
}
