/**
 * Path OpenAPI OVER của F6 — tách khỏi `f6.ts` để giữ mỗi tệp dưới `max-lines` (HB-120).
 * `f6.ts` sở hữu bảng permission + helper rồi gọi `registerF6OverPaths`; tệp này không import ngược
 * để tránh vòng lặp module. Permission vẫn lấy từ bảng duy nhất qua `helpers.add` (fail closed).
 */
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import type { ErrorCode } from '../../errors.js';
import {
  bookingRelocationOptionsSchema,
  compensationPaymentCreateRequestSchema,
  compensationPaymentSchema,
  compensationPaymentsViewSchema,
  overbookingAlertsQuerySchema,
  overbookingAlertsViewSchema,
  overbookingCaseDetailQuerySchema,
  overbookingCaseDetailSchema,
  overbookingCaseListSchema,
  overbookingCasesQuerySchema,
  overbookingResolveRequestSchema,
  overbookingResolveResponseSchema,
  relocationOptionsQuerySchema,
  relocationPlanRequestSchema,
  relocationPlanSchema,
  roomMergeApproveRequestSchema,
  roomMergeConsentRequestSchema,
  roomMergeRequestSchema,
  roomMergeSchema,
  roomMergeViewSchema,
  roomMoveApproveRequestSchema,
  roomMoveCreateRequestSchema,
  roomMoveExecuteRequestSchema,
  roomMoveSchema,
  roomMoveViewSchema,
  writeIntentQuerySchema,
} from '../../overbooking.js';
import { bearerWrite, idempotencyHeaders, ifMatchHeader, jsonBody, pathParam } from '../shared.js';

export type F6Responses = NonNullable<RouteConfig['responses']>;
export type F6RouteConfig = Omit<RouteConfig, 'method' | 'path' | 'operationId' | 'x-permissions'>;
type F6Method = 'get' | 'post' | 'put';

/** Helper do `f6.ts` cung cấp: đăng ký route, gom mã lỗi chuẩn và dựng phản hồi. */
export interface F6PathsHelpers {
  readonly add: (
    method: F6Method,
    path: string,
    operationId: string,
    config: F6RouteConfig,
  ) => void;
  readonly read: (tags: string[]) => { tags: string[]; security: Record<string, string[]>[] };
  readonly accepted: (description: string, schema: z.ZodTypeAny) => F6Responses[string];
  readonly ok: (description: string, schema: z.ZodTypeAny) => F6Responses[string];
  readonly okEtag: (description: string, schema: z.ZodTypeAny) => F6Responses[string];
  readonly validation: F6Responses[string];
  readonly withRead: (part: F6Responses) => F6Responses;
  readonly withWrite: (part: F6Responses) => F6Responses;
  readonly withVersion: (part: F6Responses) => F6Responses;
  readonly errors: (...codes: readonly ErrorCode[]) => F6Responses[string];
}

export function registerF6OverPaths(h: F6PathsHelpers): void {
  const e = h.errors;

  // ---------- Ca quá tải (AC2, AC5) ----------
  h.add('get', '/api/v1/overbooking-cases', 'overbookingCasesList', {
    summary: 'Danh sách ca quá tải + metadata lần quét thành công (api.md §3.9, AC14)',
    ...h.read(['over']),
    request: { query: overbookingCasesQuerySchema },
    responses: h.withRead({ 200: h.ok('Danh sách ca', overbookingCaseListSchema) }),
  });
  h.add('get', '/api/v1/overbooking-cases/{caseId}', 'overbookingCasesGet', {
    summary: 'Chi tiết ca + ứng viên đã xếp hạng + lịch sử xử lý (BR-OVER-11/12)',
    ...h.read(['over']),
    parameters: [pathParam('caseId')],
    request: { query: overbookingCaseDetailQuerySchema },
    responses: h.withRead({ 200: h.ok('Chi tiết ca', overbookingCaseDetailSchema) }),
  });
  h.add(
    'post',
    '/api/v1/overbooking-cases/{caseId}/relocation-plan',
    'overbookingCasesRelocationPlan',
    {
      summary: 'Tính thang 4 bậc + thứ tự keepScore; trả phương án PROPOSED, chưa gán phòng',
      ...bearerWrite(['over']),
      parameters: [...idempotencyHeaders, ifMatchHeader, pathParam('caseId')],
      request: { body: jsonBody(relocationPlanRequestSchema) },
      responses: h.withVersion({
        200: h.ok('Phương án PROPOSED', relocationPlanSchema),
        409: e('E_OVER_NO_PLAN_AVAILABLE', 'E_SYS_IDEMPOTENCY_KEY_REUSED'),
      }),
    },
  );
  h.add('post', '/api/v1/overbooking-cases/{caseId}/resolve', 'overbookingCasesResolve', {
    summary:
      'Đóng ca sau xử lý; ca ESCALATED/quá hạn vẫn đóng được (BR-OVER-16, không cấm execute)',
    ...bearerWrite(['over']),
    parameters: [...idempotencyHeaders, ifMatchHeader, pathParam('caseId')],
    request: { body: jsonBody(overbookingResolveRequestSchema) },
    responses: h.withVersion({
      200: h.okEtag('Ca đã đóng', overbookingResolveResponseSchema),
      400: h.validation,
    }),
  });

  // ---------- Điều chuyển phòng (AC2, AC6, AC12, AC13) ----------
  h.add('post', '/api/v1/room-moves', 'roomMovesCreate', {
    summary: 'Lập phương án điều chuyển (PROPOSED); priceLocked=true, phí do MANAGER duyệt sau',
    ...bearerWrite(['over']),
    parameters: idempotencyHeaders,
    request: { body: jsonBody(roomMoveCreateRequestSchema) },
    responses: h.withWrite({
      201: h.ok('Phương án điều chuyển', roomMoveSchema),
      400: h.validation,
      409: e(
        'E_OVER_MOVE_NOT_ALLOWED',
        'E_OVER_NO_PLAN_AVAILABLE',
        'E_OVER_CROSS_CITY_NO_CONSENT',
        'E_SYS_IDEMPOTENCY_KEY_REUSED',
      ),
    }),
  });
  h.add('get', '/api/v1/room-moves/{roomMoveId}', 'roomMovesGet', {
    summary: 'Đọc phương án để bàn giao/đối soát; allowedActions theo quyền, chứng từ đã che',
    ...h.read(['over']),
    parameters: [pathParam('roomMoveId')],
    request: { query: writeIntentQuerySchema },
    responses: h.withRead({ 200: h.okEtag('Phương án điều chuyển', roomMoveViewSchema) }),
  });
  h.add('post', '/api/v1/room-moves/{roomMoveId}/approve', 'roomMovesApprove', {
    summary: 'Duyệt điều chuyển và chi phí bồi thường; 🔒 PIN; cần If-Match',
    ...bearerWrite(['over']),
    parameters: [...idempotencyHeaders, ifMatchHeader, pathParam('roomMoveId')],
    request: { body: jsonBody(roomMoveApproveRequestSchema) },
    responses: h.withVersion({
      200: h.okEtag('Phương án đã duyệt', roomMoveSchema),
      401: e('E_AUTH_PIN_REQUIRED'),
    }),
  });
  h.add('post', '/api/v1/room-moves/{roomMoveId}/execute', 'roomMovesExecute', {
    summary: 'Thực thi điều chuyển trong một TX; 🔒 PIN; cần If-Match (BR-OVER-08/10)',
    ...bearerWrite(['over']),
    parameters: [...idempotencyHeaders, ifMatchHeader, pathParam('roomMoveId')],
    request: { body: jsonBody(roomMoveExecuteRequestSchema) },
    responses: h.withVersion({
      200: h.okEtag('Phương án đã thực thi', roomMoveSchema),
      401: e('E_AUTH_PIN_REQUIRED'),
      403: e('E_OVER_APPROVAL_REQUIRED', 'E_RBAC_FORBIDDEN'),
      409: e(
        'E_OVER_MOVE_NOT_ALLOWED',
        'E_OVER_NO_PLAN_AVAILABLE',
        'E_INV_ROOM_TAKEN',
        'E_SYS_IDEMPOTENCY_KEY_REUSED',
      ),
    }),
  });
  h.add(
    'post',
    '/api/v1/room-moves/{roomMoveId}/compensation-payments',
    'roomMovesCompensationPaymentsCreate',
    {
      summary:
        'Chi bồi thường (ACCOUNTANT + PIN): số tiền từ quyết định đã duyệt, tách PENDING/UNKNOWN khỏi SUCCEEDED',
      ...bearerWrite(['over']),
      parameters: [...idempotencyHeaders, ifMatchHeader, pathParam('roomMoveId')],
      request: { body: jsonBody(compensationPaymentCreateRequestSchema) },
      responses: h.withVersion({
        200: h.ok('Khoản chi bồi thường', compensationPaymentSchema),
        400: h.validation,
        401: e('E_AUTH_PIN_REQUIRED'),
        422: e('E_PAY_AMOUNT_MISMATCH'),
      }),
    },
  );
  h.add(
    'get',
    '/api/v1/room-moves/{roomMoveId}/compensation-payments',
    'roomMovesCompensationPaymentsList',
    {
      summary: 'Đọc chứng từ/trạng thái khoản bồi thường theo projection nhiệm vụ (không được chi)',
      ...h.read(['over']),
      parameters: [pathParam('roomMoveId')],
      responses: h.withRead({
        200: h.ok('Khoản chi và số tiền đã duyệt', compensationPaymentsViewSchema),
      }),
    },
  );

  // ---------- Ghép phòng (D01, AC2, AC6) ----------
  h.add('post', '/api/v1/room-merges', 'roomMergesCreate', {
    summary:
      'Tạo ghép phòng: SHARE hai booking + consent; CONNECTING một booking + `roomIdA`/`roomIdB` (D01)',
    ...bearerWrite(['over']),
    parameters: idempotencyHeaders,
    request: { body: jsonBody(roomMergeRequestSchema) },
    responses: h.withWrite({
      201: h.ok('Phương án ghép', roomMergeSchema),
      400: h.validation,
      409: e('E_OVER_NO_CONSENT', 'E_SYS_IDEMPOTENCY_KEY_REUSED'),
    }),
  });
  h.add('get', '/api/v1/room-merges/{roomMergeId}', 'roomMergesGet', {
    summary: 'Đọc phương án ghép; chứng từ đã che, allowedActions theo quyền (AC12)',
    ...h.read(['over']),
    parameters: [pathParam('roomMergeId')],
    request: { query: writeIntentQuerySchema },
    responses: h.withRead({ 200: h.okEtag('Phương án ghép', roomMergeViewSchema) }),
  });
  h.add('post', '/api/v1/room-merges/{roomMergeId}/consent', 'roomMergesConsent', {
    summary: 'Ghi nhận đồng thuận SHARE (PRIMARY/SECONDARY + bằng chứng); cần If-Match',
    ...bearerWrite(['over']),
    parameters: [...idempotencyHeaders, ifMatchHeader, pathParam('roomMergeId')],
    request: { body: jsonBody(roomMergeConsentRequestSchema) },
    responses: h.withVersion({
      200: h.okEtag('Phương án ghép sau consent', roomMergeSchema),
      400: h.validation,
    }),
  });
  h.add('post', '/api/v1/room-merges/{roomMergeId}/approve', 'roomMergesApprove', {
    summary: 'Duyệt ghép (bắt buộc khi khác giới/UNSPECIFIED — BR-OVER-14); cần If-Match',
    ...bearerWrite(['over']),
    parameters: [...idempotencyHeaders, ifMatchHeader, pathParam('roomMergeId')],
    request: { body: jsonBody(roomMergeApproveRequestSchema) },
    responses: h.withVersion({
      200: h.okEtag('Phương án ghép đã duyệt', roomMergeSchema),
      409: e('E_OVER_NO_CONSENT', 'E_SYS_IDEMPOTENCY_KEY_REUSED'),
    }),
  });
  h.add('post', '/api/v1/room-merges/{roomMergeId}/execute', 'roomMergesExecute', {
    summary: 'Kiểm lại consent/sức chứa/version và gán trong một TX; cần If-Match',
    ...bearerWrite(['over']),
    parameters: [...idempotencyHeaders, ifMatchHeader, pathParam('roomMergeId')],
    responses: h.withVersion({
      200: h.okEtag('Phương án ghép đã hiệu lực', roomMergeSchema),
      409: e(
        'E_OVER_NO_CONSENT',
        'E_OVER_MERGE_GENDER',
        'E_INV_ROOM_TAKEN',
        'E_SYS_IDEMPOTENCY_KEY_REUSED',
      ),
    }),
  });

  // ---------- Đọc phục vụ chuyển việc (AC12) ----------
  h.add('get', '/api/v1/bookings/{bookingId}/relocation-options', 'bookingsRelocationOptions', {
    summary: 'Phương án cho đúng booking này; không lộ bảng xếp hạng/PII booking khác',
    ...h.read(['over']),
    parameters: [pathParam('bookingId')],
    request: { query: relocationOptionsQuerySchema },
    responses: h.withRead({ 200: h.ok('Phương án của booking', bookingRelocationOptionsSchema) }),
  });
  h.add('get', '/api/v1/overbooking-alerts', 'overbookingAlerts', {
    summary: 'Cảnh báo quá tải cho FRONT_DESK: chỉ booking cần xử lý, ngày và liên kết được phép',
    ...h.read(['over']),
    request: { query: overbookingAlertsQuerySchema },
    responses: {
      200: h.ok('Danh sách cảnh báo', overbookingAlertsViewSchema),
      403: e('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE'),
    },
  });
}
