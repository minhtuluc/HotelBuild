/**
 * Bảng tuyến BFF phiên nhân viên cho các màn F6 (HB-217) + bộ xử lý dùng chung. Mỗi `route.ts` chỉ chọn id
 * của mình trong `F6_CATALOGUE`; bộ xử lý dựng `JourneyRoute` rồi giao cho `createJourneyHandler`, nên
 * CSRF (`Origin` + `X-Session-Request`), khoá `Idempotency-Key` UUIDv4, chuyển tiếp `If-Match`/`ETag`/`Retry-After`
 * và danh sách trắng chi tiết lỗi là của nhà máy chung. Ở đây **không** có logic nghiệp vụ, không tuyến bắt-tất-cả,
 * không đọc/ghi/ghi log `pinToken`: thân lệnh 🔒 đã chứa `pinToken` do trình duyệt đặt, chỉ được chuyển tiếp.
 */
import { ApiError, type Decoder, type QueryValue } from '@pinehill/api-client';
import {
  bookingRelocationOptionsSchema,
  channelMappingPutRequestSchema,
  channelMappingsViewSchema,
  channelSyncRequestSchema,
  channelSyncStatusViewSchema,
  compensationPaymentCreateRequestSchema,
  compensationPaymentSchema,
  compensationPaymentsViewSchema,
  listResponseSchema,
  operationRefSchema,
  otaBookingFlagRequestSchema,
  otaBookingSchema,
  otaBookingsQuerySchema,
  outboxDeliveriesQuerySchema,
  outboxDeliverySchema,
  overbookingCaseDetailQuerySchema,
  overbookingCaseDetailSchema,
  overbookingCaseListSchema,
  overbookingCasesQuerySchema,
  overbookingResolveRequestSchema,
  overbookingResolveResponseSchema,
  pinTokenSchema,
  pinVerifyRequestSchema,
  refundApproveRequestSchema,
  refundDecisionSchema,
  refundListQuerySchema,
  refundRejectRequestSchema,
  refundRequestCreateRequestSchema,
  refundRequestSchema,
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
  salesClosureRequestSchema,
  salesClosureViewSchema,
  writeIntentQuerySchema,
} from '@pinehill/contracts';
import { createJourneyHandler } from '@pinehill/web-session/server';
import { sessionConfig } from '../../../../config/session';
import { decodedId } from './route-id';

type Resolver = NonNullable<Parameters<typeof createJourneyHandler>[0]['routeResolver']>;
type JourneyRoute = Exclude<ReturnType<Resolver>, undefined>;
type Method = 'GET' | 'POST' | 'PUT';
type Query = (input: Record<string, string>) => Record<string, QueryValue>;

export interface F6Entry {
  readonly id: string;
  readonly method: Method;
  /** Đường dẫn dưới `/api/session/sys`, đoạn `:tên` là tham số đã giải mã; trùng đường dẫn upstream `/api/v1`. */
  readonly pattern: string;
  readonly body?: Decoder<unknown>;
  readonly query?: Query;
  readonly decoder: Decoder<unknown>;
  /** Tên trường được phép lộ trong `details` của 400/422 (không bao giờ gồm `pinToken`). */
  readonly fields: readonly string[];
}

const scalar = (value: unknown): value is QueryValue =>
  value === undefined || ['string', 'number', 'boolean'].includes(typeof value);

/**
 * Chỉ khoá có trong schema: khoá lạ làm lỗi 400 (không tự bỏ qua). `z.coerce.boolean` coi `"false"` là `true`,
 * nên cờ boolean chỉ nhận `true` hoặc vắng mặt — không bao giờ để chuỗi `false` lọt sang thành `true`.
 */
function allow(schema: Decoder<object>, flags: readonly string[] = []): Query {
  return (input) => {
    if (flags.some((flag) => input[flag] !== undefined && input[flag] !== 'true'))
      throw new Error('Boolean flag must be true or absent');
    const parsed = Object.entries(schema.parse(input));
    const known = new Set(parsed.map(([key]) => key));
    if (Object.keys(input).some((key) => !known.has(key))) throw new Error('Unknown query key');
    const out: Record<string, QueryValue> = {};
    for (const [key, value] of parsed) {
      if (!scalar(value)) throw new Error('Query value must be scalar');
      out[key] = value;
    }
    return out;
  };
}

const page = (item: Parameters<typeof listResponseSchema>[0]) => listResponseSchema(item);

export const F6_CATALOGUE: readonly F6Entry[] = [
  {
    id: 'mappings.put',
    method: 'PUT',
    pattern: '/channels/:id/mappings',
    body: channelMappingPutRequestSchema,
    decoder: channelMappingsViewSchema,
    fields: [
      'roomTypeId',
      'providerRoomTypeCode',
      'allotmentPct',
      'externalRatePlanCode',
      'status',
    ],
  },
  {
    id: 'closure.post',
    method: 'POST',
    pattern: '/channels/:id/sales-closure',
    body: salesClosureRequestSchema,
    decoder: salesClosureViewSchema,
    fields: ['roomTypeId', 'from', 'to', 'reason', 'closed'],
  },
  {
    id: 'sync.post',
    method: 'POST',
    pattern: '/channels/:id/sync',
    body: channelSyncRequestSchema,
    decoder: operationRefSchema,
    fields: ['scope', 'from', 'to', 'roomTypeIds'],
  },
  {
    id: 'syncStatus.get',
    method: 'GET',
    pattern: '/channels/:id/sync-status',
    decoder: channelSyncStatusViewSchema,
    fields: [],
  },
  {
    id: 'deliveries.get',
    method: 'GET',
    pattern: '/channels/:id/outbox-deliveries',
    query: allow(outboxDeliveriesQuerySchema),
    decoder: page(outboxDeliverySchema),
    fields: [],
  },
  {
    id: 'deliveries.retry',
    method: 'POST',
    pattern: '/channels/:id/outbox-deliveries/:deliveryId/retry',
    decoder: operationRefSchema,
    fields: [],
  },
  {
    id: 'otaBookings.get',
    method: 'GET',
    pattern: '/channels/:id/ota-bookings',
    query: allow(otaBookingsQuerySchema),
    decoder: page(otaBookingSchema),
    fields: [],
  },
  {
    id: 'otaBookings.flag',
    method: 'POST',
    pattern: '/channels/:id/ota-bookings/:bookingId/duplicate-flag',
    body: otaBookingFlagRequestSchema,
    decoder: otaBookingSchema,
    fields: ['flagged', 'reason'],
  },
  {
    id: 'cases.list',
    method: 'GET',
    pattern: '/overbooking-cases',
    query: allow(overbookingCasesQuerySchema, ['overdueOnly']),
    decoder: overbookingCaseListSchema,
    fields: [],
  },
  {
    id: 'cases.get',
    method: 'GET',
    pattern: '/overbooking-cases/:id',
    query: allow(overbookingCaseDetailQuerySchema, ['includeCandidates']),
    decoder: overbookingCaseDetailSchema,
    fields: [],
  },
  {
    id: 'cases.plan',
    method: 'POST',
    pattern: '/overbooking-cases/:id/relocation-plan',
    body: relocationPlanRequestSchema,
    decoder: relocationPlanSchema,
    fields: ['strategy'],
  },
  {
    id: 'cases.resolve',
    method: 'POST',
    pattern: '/overbooking-cases/:id/resolve',
    body: overbookingResolveRequestSchema,
    decoder: overbookingResolveResponseSchema,
    fields: ['resolutionNote'],
  },
  {
    id: 'options.get',
    method: 'GET',
    pattern: '/bookings/:id/relocation-options',
    query: allow(relocationOptionsQuerySchema),
    decoder: bookingRelocationOptionsSchema,
    fields: [],
  },
  {
    id: 'moves.create',
    method: 'POST',
    pattern: '/room-moves',
    body: roomMoveCreateRequestSchema,
    decoder: roomMoveSchema,
    fields: [
      'overbookingCaseId',
      'bookingId',
      'bookingRoomId',
      'moveType',
      'toRoomId',
      'toPropertyId',
      'reason',
      'compensationAmount',
      'transportCost',
      'consent',
      'walkOut',
    ],
  },
  {
    id: 'moves.get',
    method: 'GET',
    pattern: '/room-moves/:id',
    query: allow(writeIntentQuerySchema),
    decoder: roomMoveViewSchema,
    fields: [],
  },
  {
    id: 'moves.approve',
    method: 'POST',
    pattern: '/room-moves/:id/approve',
    body: roomMoveApproveRequestSchema,
    decoder: roomMoveSchema,
    fields: ['compensationAmount', 'transportCost', 'note'],
  },
  {
    id: 'moves.execute',
    method: 'POST',
    pattern: '/room-moves/:id/execute',
    body: roomMoveExecuteRequestSchema,
    decoder: roomMoveSchema,
    fields: [],
  },
  {
    id: 'compensation.get',
    method: 'GET',
    pattern: '/room-moves/:id/compensation-payments',
    decoder: compensationPaymentsViewSchema,
    fields: [],
  },
  {
    id: 'compensation.create',
    method: 'POST',
    pattern: '/room-moves/:id/compensation-payments',
    body: compensationPaymentCreateRequestSchema,
    decoder: compensationPaymentSchema,
    fields: ['method', 'evidenceRefs', 'bankReference', 'note'],
  },
  {
    id: 'merges.create',
    method: 'POST',
    pattern: '/room-merges',
    body: roomMergeRequestSchema,
    decoder: roomMergeSchema,
    fields: [
      'moveType',
      'primaryBookingId',
      'secondaryBookingId',
      'roomId',
      'bookingId',
      'roomIdA',
      'roomIdB',
      'discountPct',
    ],
  },
  {
    id: 'merges.get',
    method: 'GET',
    pattern: '/room-merges/:id',
    query: allow(writeIntentQuerySchema),
    decoder: roomMergeViewSchema,
    fields: [],
  },
  {
    id: 'merges.consent',
    method: 'POST',
    pattern: '/room-merges/:id/consent',
    body: roomMergeConsentRequestSchema,
    decoder: roomMergeSchema,
    fields: ['side', 'consented', 'evidenceUrl'],
  },
  {
    id: 'merges.approve',
    method: 'POST',
    pattern: '/room-merges/:id/approve',
    body: roomMergeApproveRequestSchema,
    decoder: roomMergeSchema,
    fields: ['reason'],
  },
  {
    id: 'merges.execute',
    method: 'POST',
    pattern: '/room-merges/:id/execute',
    decoder: roomMergeSchema,
    fields: [],
  },
  {
    id: 'refunds.list',
    method: 'GET',
    pattern: '/refund-requests',
    query: allow(refundListQuerySchema),
    decoder: page(refundRequestSchema),
    fields: [],
  },
  {
    id: 'refunds.create',
    method: 'POST',
    pattern: '/refund-requests',
    body: refundRequestCreateRequestSchema,
    decoder: refundRequestSchema,
    fields: ['bookingId', 'paymentId', 'reason', 'isForceMajeure', 'evidenceRefs', 'note'],
  },
  {
    id: 'refunds.approve',
    method: 'POST',
    pattern: '/refund-requests/:id/approve',
    body: refundApproveRequestSchema,
    decoder: refundDecisionSchema,
    fields: ['approvedAmount', 'note'],
  },
  {
    id: 'refunds.reject',
    method: 'POST',
    pattern: '/refund-requests/:id/reject',
    body: refundRejectRequestSchema,
    decoder: refundRequestSchema,
    fields: ['note'],
  },
  {
    id: 'pin.verify',
    method: 'POST',
    pattern: '/auth/pin/verify',
    body: pinVerifyRequestSchema,
    decoder: pinTokenSchema,
    fields: ['pin', 'bookingId'],
  },
];

const PREFIX = '/api/session/sys';
const escaped = (segment: string): string => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Khớp đường dẫn; mọi tham số phải qua `decodedId` (từ chối rỗng, `.`/`..`, chứa `/` hoặc `\`). */
function paramsOf(entry: F6Entry, pathname: string): string[] | undefined {
  const source = entry.pattern
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '([^/]+)' : escaped(segment)))
    .join('/');
  const match = new RegExp(`^${escaped(PREFIX)}${source}$`).exec(pathname);
  if (match === null) return undefined;
  const ids = match.slice(1).map((value) => decodedId(value));
  return ids.every((id) => id !== undefined) ? ids.filter((id) => id !== undefined) : undefined;
}

function upstream(entry: F6Entry, ids: readonly string[]): string {
  let index = 0;
  return entry.pattern
    .split('/')
    .map((segment) => (segment.startsWith(':') ? encodeURIComponent(ids[index++] ?? '') : segment))
    .join('/');
}

export function resolveF6(
  entries: readonly F6Entry[],
  method: string,
  pathname: string,
): { entry: F6Entry; route: JourneyRoute } | undefined {
  for (const entry of entries) {
    const ids = entry.method === method ? paramsOf(entry, pathname) : undefined;
    if (ids === undefined) continue;
    const route: JourneyRoute = {
      method: entry.method,
      path: upstream(entry, ids),
      protected: true,
      decoder: entry.decoder,
      ...(entry.body === undefined ? {} : { body: entry.body }),
      ...(entry.query === undefined ? {} : { query: entry.query }),
    };
    return { entry, route };
  }
  return undefined;
}

/** Bộ xử lý của một `route.ts`: chỉ nhận các id đã chọn, mọi thứ khác là 404 của nhà máy chung. */
export function f6Handler(...ids: readonly string[]): (request: Request) => Promise<Response> {
  const entries = F6_CATALOGUE.filter((entry) => ids.includes(entry.id));
  if (entries.length !== ids.length)
    throw new ApiError({ kind: 'protocol', message: 'Unknown F6 route id' });
  return (request) => {
    const hit = resolveF6(entries, request.method, new URL(request.url).pathname);
    return createJourneyHandler({
      ...sessionConfig(),
      validationFields: hit?.entry.fields ?? [],
      routeResolver: () => hit?.route,
    })(request);
  };
}
