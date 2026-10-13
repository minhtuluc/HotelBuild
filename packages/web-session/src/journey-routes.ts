import {
  bookingBalanceSchema,
  onlinePaymentCreateRequestSchema,
  paymentSchema,
  paymentStatusViewSchema,
  availabilityQuerySchema,
  availabilitySchema,
  businessDateSchema,
  bookingCreateRequestSchema,
  bookingsQuerySchema,
  bookingSummarySchema,
  cancelPreviewRequestSchema,
  cancelPreviewSchema,
  cancelRequestSchema,
  cancelResponseSchema,
  holdCreateRequestSchema,
  holdReleaseQuerySchema,
  holdSchema,
  guestLoyaltySchema,
  guestSummarySchema,
  listResponseSchema,
  propertyPublicSummarySchema,
  quoteRequestSchema,
  quoteSchema,
  ratePlanPublicSchema,
  rescheduleRequestSchema,
} from '@pinehill/contracts';
import type { Decoder, HttpMethod, QueryValue } from '@pinehill/api-client';
export class JourneyInputError extends Error {}
export interface JourneyRoute {
  method: HttpMethod;
  path: string;
  protected: boolean;
  decoder?: Decoder<unknown>;
  body?: Decoder<unknown>;
  /** Trusted protected route only; byte cap cannot exceed the API transport ceiling (1 MiB). */
  maxBodyBytes?: number;
  query?: (input: Record<string, string>) => Record<string, QueryValue>;
}
export function parseInput<T>(decoder: Decoder<T>, input: unknown): T {
  try {
    return decoder.parse(input);
  } catch {
    throw new JourneyInputError();
  }
}
/**
 * `GET /bookings` — chỉ giữ các khoá `bookingsQuerySchema` cho phép (HB-102); truy vấn lạ bị từ chối
 * thay vì chuyển tiếp mù sang API (cùng nguyên tắc với `planQuery`).
 */
function bookingsQuery(input: Record<string, string>): Record<string, QueryValue> {
  const parsed = parseInput(bookingsQuerySchema, input);
  const result: Record<string, QueryValue> = { limit: parsed.limit };
  if (parsed.cursor !== undefined) result.cursor = parsed.cursor;
  if (parsed.sort !== undefined) result.sort = parsed.sort;
  if (parsed.from !== undefined) result.from = parsed.from;
  if (parsed.to !== undefined) result.to = parsed.to;
  if (parsed.q !== undefined) result.q = parsed.q;
  if (parsed.propertyId !== undefined) result.propertyId = parsed.propertyId;
  if (parsed.status !== undefined) result.status = parsed.status;
  if (parsed.channelCode !== undefined) result.channelCode = parsed.channelCode;
  return result;
}

function planQuery(input: Record<string, string>): Record<string, QueryValue> {
  const validators: Readonly<Record<string, Decoder<string>>> = {
    propertyId: quoteRequestSchema.shape.propertyId,
    checkIn: businessDateSchema,
    checkOut: businessDateSchema,
  };
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(validators, key)) throw new JourneyInputError();
    result[key] = parseInput(validators[key]!, value);
  }
  return result;
}
const depositBody: Decoder<unknown> = {
  parse(input: unknown) {
    const value = onlinePaymentCreateRequestSchema.parse(input);
    if (value.type !== 'DEPOSIT' || !['VNPAY', 'MOMO'].includes(value.method))
      throw new JourneyInputError();
    return value;
  },
};
const staticRoutes = new Map<string, JourneyRoute>([
  [
    'POST payments/online',
    {
      method: 'POST',
      path: '/payments/online',
      protected: true,
      decoder: paymentSchema,
      body: depositBody,
    },
  ],
  [
    'GET inventory/availability',
    {
      method: 'GET',
      path: '/inventory/availability',
      protected: false,
      decoder: availabilitySchema,
      query: (input) => parseInput(availabilityQuerySchema, input),
    },
  ],
  [
    'GET public/properties',
    {
      method: 'GET',
      path: '/public/properties',
      protected: false,
      decoder: listResponseSchema(propertyPublicSummarySchema),
    },
  ],
  [
    'GET rate-plans',
    {
      method: 'GET',
      path: '/rate-plans',
      protected: false,
      decoder: listResponseSchema(ratePlanPublicSchema),
      query: planQuery,
    },
  ],
  [
    'POST quotes',
    {
      method: 'POST',
      path: '/quotes',
      protected: false,
      decoder: quoteSchema,
      body: quoteRequestSchema,
    },
  ],
  [
    'GET guests/me',
    {
      method: 'GET',
      path: '/guests/me',
      protected: true,
      decoder: guestSummarySchema,
    },
  ],
  [
    'GET guests/me/loyalty',
    {
      method: 'GET',
      path: '/guests/me/loyalty',
      protected: true,
      decoder: guestLoyaltySchema,
    },
  ],
  [
    'GET bookings',
    {
      method: 'GET',
      path: '/bookings',
      protected: true,
      decoder: listResponseSchema(bookingSummarySchema),
      query: bookingsQuery,
    },
  ],
  [
    'POST holds',
    {
      method: 'POST',
      path: '/holds',
      protected: true,
      decoder: holdSchema,
      body: holdCreateRequestSchema,
    },
  ],
  [
    'POST bookings',
    {
      method: 'POST',
      path: '/bookings',
      protected: true,
      decoder: bookingSummarySchema,
      body: bookingCreateRequestSchema,
    },
  ],
]);
function decodedId(value: string): string | undefined {
  let id: string;
  try {
    id = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  if (id === '.' || id === '..' || id.includes('/') || id.includes('\\') || !id.trim())
    return undefined;
  return id;
}
/**
 * Hành động trên một booking (SCR-11): chỉ những tên có trong bảng này mới được chuyển tiếp, kèm bộ
 * giải mã/bộ kiểm thân lệnh theo hợp đồng F5.
 */
const BOOKING_ACTIONS: Readonly<
  Record<string, { readonly decoder: Decoder<unknown>; readonly body: Decoder<unknown> }>
> = {
  'cancel-preview': { decoder: cancelPreviewSchema, body: cancelPreviewRequestSchema },
  cancel: { decoder: cancelResponseSchema, body: cancelRequestSchema },
  reschedule: { decoder: bookingSummarySchema, body: rescheduleRequestSchema },
};

/** Tuyến trên chính đối tượng (không có hành động phía sau). */
function objectRoute(method: string, resource: string, base: string): JourneyRoute | undefined {
  if (method === 'GET' && resource === 'bookings')
    return { method: 'GET', path: base, protected: true, decoder: bookingSummarySchema };
  if (method === 'DELETE' && resource === 'holds')
    return {
      method: 'DELETE',
      path: base,
      protected: true,
      query: (input) => parseInput(holdReleaseQuerySchema, input),
    };
  return undefined;
}

function paymentStatusRoute(method: string, path: string): JourneyRoute | undefined {
  const payment = /^payments\/([^/]+)\/status$/.exec(path);
  if (method === 'GET' && payment) {
    const id = decodedId(payment[1]!);
    if (id === undefined) return undefined;
    return {
      method: 'GET',
      path: `/payments/${encodeURIComponent(id)}/status`,
      protected: true,
      decoder: paymentStatusViewSchema,
    };
  }
  return undefined;
}
function balanceRoute(
  method: string,
  resource: string,
  action: string,
  base: string,
): JourneyRoute | undefined {
  if (method === 'GET' && resource === 'bookings' && action === 'balance')
    return {
      method: 'GET',
      path: `${base}/balance`,
      protected: true,
      decoder: bookingBalanceSchema,
    };
  return undefined;
}
function dynamicRoute(method: string, path: string): JourneyRoute | undefined {
  const payment = paymentStatusRoute(method, path);
  if (payment) return payment;
  const dynamic = /^(holds|bookings)\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (!dynamic) return undefined;
  const resource = dynamic[1]!;
  const id = decodedId(dynamic[2]!);
  if (id === undefined) return undefined;
  const action = dynamic[3];
  const base = `/${resource}/${encodeURIComponent(id)}`;
  if (action === undefined) return objectRoute(method, resource, base);
  const balance = balanceRoute(method, resource, action, base);
  if (balance) return balance;
  const spec = BOOKING_ACTIONS[action];
  if (method !== 'POST' || resource !== 'bookings' || spec === undefined) return undefined;
  return {
    method: 'POST',
    path: `${base}/${action}`,
    protected: true,
    decoder: spec.decoder,
    body: spec.body,
  };
}

export function journeyRoute(request: Request): JourneyRoute | undefined {
  const pathname = new URL(request.url).pathname;
  const prefix = '/api/session/journey/';
  if (!pathname.startsWith(prefix)) return undefined;
  const path = pathname.slice(prefix.length);
  return staticRoutes.get(`${request.method} ${path}`) ?? dynamicRoute(request.method, path);
}
