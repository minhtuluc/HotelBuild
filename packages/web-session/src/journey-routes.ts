import {
  availabilityQuerySchema,
  availabilitySchema,
  businessDateSchema,
  bookingCreateRequestSchema,
  bookingSummarySchema,
  holdCreateRequestSchema,
  holdReleaseQuerySchema,
  holdSchema,
  listResponseSchema,
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
