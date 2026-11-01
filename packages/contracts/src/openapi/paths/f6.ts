/**
 * Path OpenAPI pha F6 (CHAN + OVER) — HB-120.
 *
 * Là **nguồn duy nhất** công bố tuyến F6 và ánh xạ permission của chúng. Route CHAN đăng ký tại đây;
 * route OVER ở `f6-over.ts` nhưng cũng chỉ đăng ký qua helper `add` của tệp này, nên route thiếu ánh xạ
 * làm hỏng nạp module (fail closed, api.md §6.3) thay vì mặc định cho qua. Permission chỉ là dữ liệu
 * công bố; backend vẫn cưỡng chế ở guard/service.
 */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import {
  channelMappingPutRequestSchema,
  channelMappingsViewSchema,
  channelSyncRequestSchema,
  channelSyncStatusViewSchema,
  otaBookingFlagRequestSchema,
  otaBookingSchema,
  otaBookingsQuerySchema,
  otaInboxAckSchema,
  otaWebhookEventSchema,
  outboxDeliveriesQuerySchema,
  outboxDeliverySchema,
  salesClosureRequestSchema,
  salesClosureViewSchema,
} from '../../channel.js';
import { listResponseSchema, operationRefSchema } from '../../common.js';
import type { UserRole } from '../../enums.js';
import type { F6PathsHelpers, F6Responses, F6RouteConfig } from './f6-over.js';
import { registerF6OverPaths } from './f6-over.js';
import {
  bearerWrite,
  idempotencyHeaders,
  ifMatchHeader,
  jsonBody,
  makeErrorResponse,
  pathParam,
} from '../shared.js';

/** Principal phi nhân viên (OTA simulator) tách khỏi vai trò nhân viên theo api.md §6.3. */
export const F6_SERVICE_PRINCIPAL = 'OTA_SIMULATOR_SERVICE' as const;

export type F6Principal = UserRole | typeof F6_SERVICE_PRINCIPAL;

export interface F6RoutePermission {
  readonly method: 'get' | 'post' | 'put';
  readonly path: string;
  readonly roles: readonly F6Principal[];
}

/**
 * Ánh xạ route → tập principal theo api.md §6.3. Không suy quyền từ "role cao hơn": MANAGER/OWNER xử
 * lý case & đồng bộ; OWNER sửa ánh xạ cấu hình; FRONT_DESK thực thi move/merge; MANAGER/OWNER duyệt;
 * ACCOUNTANT chi bồi thường. SYSADMIN **không** có quyền nghiệp vụ F6.
 */
export const f6RoutePermissions: readonly F6RoutePermission[] = [
  { method: 'post', path: '/api/v1/channels/{channelId}/sync', roles: ['MANAGER', 'OWNER'] },
  { method: 'put', path: '/api/v1/channels/{channelId}/mappings', roles: ['OWNER'] },
  {
    method: 'post',
    path: '/api/v1/channels/{channelId}/sales-closure',
    roles: ['MANAGER', 'OWNER'],
  },
  { method: 'get', path: '/api/v1/channels/{channelId}/ota-bookings', roles: ['MANAGER', 'OWNER'] },
  { method: 'get', path: '/api/v1/channels/{channelId}/sync-status', roles: ['MANAGER', 'OWNER'] },
  {
    method: 'get',
    path: '/api/v1/channels/{channelId}/outbox-deliveries',
    roles: ['MANAGER', 'OWNER'],
  },
  {
    method: 'post',
    path: '/api/v1/channels/{channelId}/outbox-deliveries/{deliveryId}/retry',
    roles: ['MANAGER', 'OWNER'],
  },
  {
    method: 'post',
    path: '/api/v1/channels/{channelId}/ota-bookings/{bookingId}/duplicate-flag',
    roles: ['MANAGER', 'OWNER'],
  },
  {
    method: 'post',
    path: '/api/v1/integrations/ota/{channel}/bookings',
    roles: [F6_SERVICE_PRINCIPAL],
  },
  { method: 'get', path: '/api/v1/overbooking-cases', roles: ['MANAGER', 'OWNER'] },
  { method: 'get', path: '/api/v1/overbooking-cases/{caseId}', roles: ['MANAGER', 'OWNER'] },
  {
    method: 'post',
    path: '/api/v1/overbooking-cases/{caseId}/relocation-plan',
    roles: ['MANAGER', 'OWNER'],
  },
  {
    method: 'post',
    path: '/api/v1/overbooking-cases/{caseId}/resolve',
    roles: ['MANAGER', 'OWNER'],
  },
  { method: 'post', path: '/api/v1/room-moves', roles: ['FRONT_DESK'] },
  {
    method: 'get',
    path: '/api/v1/room-moves/{roomMoveId}',
    roles: ['FRONT_DESK', 'MANAGER', 'OWNER'],
  },
  { method: 'post', path: '/api/v1/room-moves/{roomMoveId}/approve', roles: ['MANAGER', 'OWNER'] },
  { method: 'post', path: '/api/v1/room-moves/{roomMoveId}/execute', roles: ['FRONT_DESK'] },
  {
    method: 'post',
    path: '/api/v1/room-moves/{roomMoveId}/compensation-payments',
    roles: ['ACCOUNTANT'],
  },
  {
    method: 'get',
    path: '/api/v1/room-moves/{roomMoveId}/compensation-payments',
    roles: ['ACCOUNTANT', 'MANAGER', 'OWNER'],
  },
  { method: 'post', path: '/api/v1/room-merges', roles: ['FRONT_DESK'] },
  {
    method: 'get',
    path: '/api/v1/room-merges/{roomMergeId}',
    roles: ['FRONT_DESK', 'MANAGER', 'OWNER'],
  },
  { method: 'post', path: '/api/v1/room-merges/{roomMergeId}/consent', roles: ['FRONT_DESK'] },
  {
    method: 'post',
    path: '/api/v1/room-merges/{roomMergeId}/approve',
    roles: ['MANAGER', 'OWNER'],
  },
  { method: 'post', path: '/api/v1/room-merges/{roomMergeId}/execute', roles: ['FRONT_DESK'] },
  { method: 'get', path: '/api/v1/bookings/{bookingId}/relocation-options', roles: ['FRONT_DESK'] },
  { method: 'get', path: '/api/v1/overbooking-alerts', roles: ['FRONT_DESK'] },
] as const;

/** Tra permission của route; thiếu ánh xạ thì ném lỗi ngay khi nạp module (fail closed). */
export function permissionsFor(
  method: F6RoutePermission['method'],
  path: string,
): readonly F6Principal[] {
  const match = f6RoutePermissions.find((entry) => entry.method === method && entry.path === path);
  if (match === undefined)
    throw new Error(`F6 route chưa được ánh xạ permission: ${method} ${path}`);
  return match.roles;
}

const locationHeader = {
  description: 'URL tuyệt đối của tài nguyên/tác vụ vừa tạo (api.md §6.4).',
  schema: { type: 'string' as const },
};
const etagHeader = {
  description: 'Phiên bản hiện hành của đối tượng; gửi lại qua `If-Match` (api.md §1.3).',
  schema: { type: 'string' as const },
};

export function registerF6Paths(registry: OpenAPIRegistry, errorBodyComponent: z.ZodTypeAny): void {
  const errorResponse = makeErrorResponse(errorBodyComponent);
  const ok = (description: string, schema: z.ZodTypeAny): F6Responses[string] => ({
    description,
    ...jsonBody(schema),
  });
  const okEtag = (description: string, schema: z.ZodTypeAny): F6Responses[string] => ({
    description,
    headers: { ETag: etagHeader },
    ...jsonBody(schema),
  });
  const accepted = (description: string, schema: z.ZodTypeAny): F6Responses[string] => ({
    description,
    headers: { Location: locationHeader },
    ...jsonBody(schema),
  });
  const denied = { 403: errorResponse('E_RBAC_FORBIDDEN', 'E_AUTH_OUT_OF_SCOPE') };
  const missing = { 404: errorResponse('E_GEN_NOT_FOUND') };
  const idem = { 409: errorResponse('E_SYS_IDEMPOTENCY_KEY_REUSED', 'E_SYS_REQUEST_IN_PROGRESS') };
  const stale = {
    412: errorResponse('E_GEN_VERSION_CONFLICT'),
    428: errorResponse('E_GEN_PRECONDITION_REQUIRED'),
  };
  const withRead = (part: F6Responses): F6Responses => ({ ...part, ...denied, ...missing });
  const withWrite = (part: F6Responses): F6Responses => ({
    ...part,
    ...denied,
    ...missing,
    ...idem,
  });
  const withVersion = (part: F6Responses): F6Responses => ({
    ...part,
    ...denied,
    ...missing,
    ...idem,
    ...stale,
  });
  const add = (
    method: F6RoutePermission['method'],
    path: string,
    operationId: string,
    config: F6RouteConfig,
  ): void => {
    registry.registerPath({
      method,
      path,
      operationId,
      'x-permissions': [...permissionsFor(method, path)],
      ...config,
    });
  };
  const helpers: F6PathsHelpers = {
    add,
    read: (tags) => ({ tags, security: [{ bearerAuth: [] }] }),
    ok,
    okEtag,
    accepted,
    validation: errorResponse('E_GEN_VALIDATION_FAILED'),
    withRead,
    withWrite,
    withVersion,
    errors: errorResponse,
  };

  // ---------- CHAN: bốn tuyến lõi (AC1) ----------
  add('post', '/api/v1/channels/{channelId}/sync', 'channelsSync', {
    summary: 'Đẩy tồn & giá lên một kênh; trả tác vụ 202 + Location (BR-CHAN-02/06)',
    ...bearerWrite(['channel']),
    parameters: [...idempotencyHeaders, pathParam('channelId')],
    request: { body: jsonBody(channelSyncRequestSchema) },
    responses: withWrite({
      202: accepted('Đã ghi nhận tác vụ đồng bộ', operationRefSchema),
      400: errorResponse('E_GEN_VALIDATION_FAILED'),
      502: errorResponse('E_CHAN_SYNC_FAILED'),
    }),
  });
  add('put', '/api/v1/channels/{channelId}/mappings', 'channelsMappingPut', {
    summary: 'Ánh xạ loại phòng ↔ mã phòng OTA (OWNER); upsert theo (channelId, roomTypeId)',
    ...bearerWrite(['channel']),
    parameters: [...idempotencyHeaders, ifMatchHeader, pathParam('channelId')],
    request: { body: jsonBody(channelMappingPutRequestSchema) },
    responses: withVersion({
      200: okEtag('Ánh xạ đã ghi', channelMappingsViewSchema),
      400: errorResponse('E_GEN_VALIDATION_FAILED'),
    }),
  });
  add('post', '/api/v1/channels/{channelId}/sales-closure', 'channelsSalesClosure', {
    summary:
      'Đóng bán theo ngày; `closed` mặc định true, false chỉ gỡ manual closure (BR-CHAN-05, AC14)',
    ...bearerWrite(['channel']),
    parameters: [...idempotencyHeaders, pathParam('channelId')],
    request: { body: jsonBody(salesClosureRequestSchema) },
    responses: withWrite({
      200: ok('Projection đóng bán kèm nguồn manual/automatic', salesClosureViewSchema),
      400: errorResponse('E_GEN_VALIDATION_FAILED'),
    }),
  });
  add('get', '/api/v1/channels/{channelId}/ota-bookings', 'channelsOtaBookings', {
    summary: 'Booking nhận từ OTA kèm trạng thái xử lý; che PII và payload (UC-CHAN-03)',
    ...helpers.read(['channel']),
    parameters: [pathParam('channelId')],
    request: { query: otaBookingsQuerySchema },
    responses: withRead({ 200: ok('Danh sách booking OTA', listResponseSchema(otaBookingSchema)) }),
  });

  // ---------- CHAN: đường đọc/retry cho SCR-40/41/42 (AC11) ----------
  add('get', '/api/v1/channels/{channelId}/sync-status', 'channelsSyncStatus', {
    summary: 'Trạng thái đồng bộ, counter lỗi và lịch sử; OK/0 sau success xác minh (AC14)',
    ...helpers.read(['channel']),
    parameters: [pathParam('channelId')],
    responses: withRead({ 200: ok('Trạng thái đồng bộ', channelSyncStatusViewSchema) }),
  });
  add('get', '/api/v1/channels/{channelId}/outbox-deliveries', 'channelsOutboxDeliveries', {
    summary: 'Giao sự kiện ra kênh theo consumer; không trả payload/credentials (AC11)',
    ...helpers.read(['channel']),
    parameters: [pathParam('channelId')],
    request: { query: outboxDeliveriesQuerySchema },
    responses: withRead({
      200: ok('Danh sách delivery', listResponseSchema(outboxDeliverySchema)),
    }),
  });
  add(
    'post',
    '/api/v1/channels/{channelId}/outbox-deliveries/{deliveryId}/retry',
    'channelsOutboxDeliveryRetry',
    {
      summary: 'Gửi lại một delivery giữ nguyên event/consumer key; trả tác vụ 202',
      ...bearerWrite(['channel']),
      parameters: [...idempotencyHeaders, pathParam('channelId'), pathParam('deliveryId')],
      responses: withWrite({ 202: accepted('Đã ghi nhận yêu cầu gửi lại', operationRefSchema) }),
    },
  );
  add(
    'post',
    '/api/v1/channels/{channelId}/ota-bookings/{bookingId}/duplicate-flag',
    'channelsOtaBookingDuplicateFlag',
    {
      summary: 'Đánh dấu nghi trùng để soát; không huỷ booking, không sửa tiền; cần If-Match',
      ...bearerWrite(['channel']),
      parameters: [
        ...idempotencyHeaders,
        ifMatchHeader,
        pathParam('channelId'),
        pathParam('bookingId'),
      ],
      request: { body: jsonBody(otaBookingFlagRequestSchema) },
      responses: withVersion({
        200: okEtag('Booking OTA sau đánh dấu', otaBookingSchema),
        400: errorResponse('E_GEN_VALIDATION_FAILED'),
      }),
    },
  );

  // ---------- CHAN: webhook simulator OTA (§5.1) — xác thực bằng chữ ký, không bearer ----------
  add('post', '/api/v1/integrations/ota/{channel}/bookings', 'integrationsOtaBookings', {
    summary:
      'Simulator Pine Hill cho OTA đẩy booking (KHÔNG phải API thật của Booking.com/Agoda/Airbnb)',
    description:
      'Ký HMAC-SHA256 trên raw body: `X-Pinehill-Signature: t=<unix>,v1=<hex(hmac(secret, t + "." + rawBody))>`. ' +
      'Lệch `t` quá 300 giây → 401. `X-Channel-Event-Id` giữ 7 ngày: trùng cùng hash → 200 `{duplicate:true}`; ' +
      'cùng ID khác hash → 409 `E_CHAN_REPLAY_DETECTED`. Ghi bền Inbox **trước** ACK 202.',
    tags: ['integration'],
    parameters: [
      {
        name: 'channel',
        in: 'path' as const,
        required: true,
        schema: { type: 'string' as const, enum: ['booking', 'agoda', 'airbnb'] },
      },
      {
        name: 'X-Pinehill-Signature',
        in: 'header' as const,
        required: true,
        schema: { type: 'string' as const },
        description: '`t=<unix>,v1=<hex>` ký trên raw body; cửa sổ ±300 giây.',
      },
      {
        name: 'X-Pinehill-Key-Id',
        in: 'header' as const,
        required: true,
        schema: { type: 'string' as const },
        description: 'Khoá bí mật của tài khoản đối tác dùng để xác minh chữ ký.',
      },
      {
        name: 'X-Channel-Event-Id',
        in: 'header' as const,
        required: true,
        schema: { type: 'string' as const },
        description: 'Khoá chống phát lại, lưu 7 ngày theo (provider, providerAccountId, eventId).',
      },
    ],
    request: { body: jsonBody(otaWebhookEventSchema) },
    responses: {
      202: ok('Đã ghi Inbox bền', otaInboxAckSchema),
      200: ok('Trùng cùng payload hash, ACK không xử lý lại', otaInboxAckSchema),
      400: errorResponse('E_GEN_VALIDATION_FAILED'),
      401: errorResponse('E_CHAN_SIGNATURE_INVALID'),
      409: errorResponse('E_CHAN_REPLAY_DETECTED'),
      503: errorResponse('E_GEN_SERVICE_UNAVAILABLE'),
    },
  });

  // ---------- OVER ----------
  registerF6OverPaths(helpers);
}
