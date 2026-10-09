import {
  availabilityQuerySchema,
  availabilitySchema,
  businessDateSchema,
  bookingCreateRequestSchema,
  bookingsQuerySchema,
  bookingSummarySchema,
  holdCreateRequestSchema,
  holdReleaseQuerySchema,
  holdSchema,
  listResponseSchema,
  propertyPublicSummarySchema,
  quoteRequestSchema,
  quoteSchema,
  ratePlanPublicSchema,
} from '@pinehill/contracts';
import type { Decoder, HttpMethod, QueryValue } from '@pinehill/api-client';
export class JourneyInputError extends Error {}
export interface JourneyRoute {
  method: HttpMethod;
  path: string;
  protected: boolean;
  decoder?: Decoder<unknown>;
  body?: Decoder<unknown>;
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
const staticRoutes = new Map<string, JourneyRoute>([
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
function dynamicRoute(method: string, path: string): JourneyRoute | undefined {
  const dynamic = /^(holds|bookings)\/([^/]+)$/.exec(path);
  if (!dynamic) return undefined;
  const id = decodedId(dynamic[2]!);
  if (id === undefined) return undefined;
  const target = `/${dynamic[1]}/${encodeURIComponent(id)}`;
  if (method === 'GET' && dynamic[1] === 'bookings')
    return { method: 'GET', path: target, protected: true, decoder: bookingSummarySchema };
  if (method === 'DELETE' && dynamic[1] === 'holds')
    return {
      method: 'DELETE',
      path: target,
      protected: true,
      query: (input) => parseInput(holdReleaseQuerySchema, input),
    };
  return undefined;
}

export function journeyRoute(request: Request): JourneyRoute | undefined {
  const pathname = new URL(request.url).pathname;
  const prefix = '/api/session/journey/';
  if (!pathname.startsWith(prefix)) return undefined;
  const path = pathname.slice(prefix.length);
  return staticRoutes.get(`${request.method} ${path}`) ?? dynamicRoute(request.method, path);
}
