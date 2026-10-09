/** Per-server scenarios for customer UI. No production money/inventory authority. */
import {
  availabilityQuerySchema,
  quoteRequestSchema,
  holdCreateRequestSchema,
  bookingCreateRequestSchema,
  type QuoteRequest,
  type Quote,
  type BookingCreateRequest,
  type HoldCreateRequest,
  type BookingSummary,
  type Hold,
} from '../../../../packages/contracts/src/index.js';
import type { FakeApiContext, FakeHandler, FakeRequest, FakeResponse, FakeBooking } from '../core/types.js';
import { ratePlans, dates, quoted, held, booked, publicProperties } from './fixtures.js';
interface StoredQuote {
  input: QuoteRequest;
  value: Quote;
  owner: string | undefined;
}
function error(status: number, code: string, path: string): FakeResponse {
  return {
    status,
    body: {
      code,
      message: 'Synthetic journey scenario',
      traceId: 'fake-journey-trace',
      timestamp: new Date().toISOString(),
      path,
    },
  };
}
function mismatch(input: HoldCreateRequest | BookingCreateRequest, quoted: QuoteRequest): boolean {
  const fields = [
    'propertyId',
    'roomTypeId',
    'channelCode',
    'checkIn',
    'checkOut',
    'adults',
    'children',
    'roomCount',
  ] as const;
  return (
    fields.some((key) => input[key] !== quoted[key]) ||
    JSON.stringify(input.childAges ?? []) !== JSON.stringify(quoted.childAges ?? []) ||
    ('ratePlanCode' in input &&
      (input.ratePlanCode !== quoted.ratePlanCode ||
        JSON.stringify(input.promotionCodes ?? []) !== JSON.stringify(quoted.promotionCodes ?? [])))
  );
}
export function createHandler(context: FakeApiContext): FakeHandler {
  const quotes = new Map<string, StoredQuote>();
  const holds = new Map<string, { value: Hold; owner: string }>();
  const duplicateBookings = new Map<string, BookingSummary>();
  const bookings = new Map<string, FakeBooking>();
  const guestIds = new Map<string, string>();
  const getGuestId = (owner: string) => {
    let id = guestIds.get(owner);
    if (!id) {
      id = `synthetic-guest-${crypto.randomUUID()}`;
      guestIds.set(owner, id);
    }
    return id;
  };
  context.getGuestId = getGuestId;
  context.listBookings = () => [...bookings.values()];
  context.getBooking = (id) => bookings.get(id);
  context.deleteBooking = (id) => {
    bookings.delete(id);
  };
  const replays = new Map<string, { fingerprint: string; response: FakeResponse }>();
  function resolveQuote(
    input: HoldCreateRequest | BookingCreateRequest,
    owner: string,
    path: string,
  ): StoredQuote | FakeResponse {
    const stored = quotes.get(input.quoteId);
    if (!stored) return error(410, 'E_RATE_QUOTE_EXPIRED', path);
    if (stored.owner !== owner) return error(409, 'E_RATE_QUOTE_MISMATCH', path);
    if (mismatch(input, stored.input)) return error(409, 'E_RATE_QUOTE_MISMATCH', path);
    if (Date.parse(stored.value.expiresAt) <= Date.now())
      return error(410, 'E_RATE_QUOTE_EXPIRED', path);
    if (stored.input.propertyId === 'journey-taken') return error(409, 'E_INV_ROOM_TAKEN', path);
    return stored;
  }
  function write(request: FakeRequest, owner: string): FakeResponse {
    const path = request.url.pathname;
    if (path.endsWith('/holds')) {
      const parsed = holdCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) return error(400, 'E_GEN_VALIDATION_FAILED', path);
      const stored = resolveQuote(parsed.data, owner, path);
      if ('status' in stored) return stored;
      const value = held(stored.value);
      holds.set(value.holdId, { value, owner });
      return { status: 201, body: value };
    }
    const parsed = bookingCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(400, 'E_GEN_VALIDATION_FAILED', path);
    const stored = resolveQuote(parsed.data, owner, path);
    if ('status' in stored) return stored;
    const input = parsed.data;
    const duplicateKey = JSON.stringify([
      owner,
      input.propertyId,
      input.channelCode,
      input.guest.phone,
      input.roomTypeId,
      input.checkIn,
    ]);
    const prior =
      input.propertyId === 'journey-duplicate' ? duplicateBookings.get(duplicateKey) : undefined;
    const value = prior ?? { ...booked(input, stored.value), guestId: getGuestId(owner) };
    if (input.propertyId === 'journey-duplicate') duplicateBookings.set(duplicateKey, value);
    bookings.set(value.id, { value, owner, channelCode: input.channelCode });
    return { status: 201, body: value };
  }
  function idempotent(
    request: FakeRequest,
    owner: string | undefined,
    perform: () => FakeResponse,
  ): FakeResponse {
    const path = request.url.pathname;
    if (!request.idempotencyKey) return error(400, 'E_GEN_VALIDATION_FAILED', path);
    const key = JSON.stringify([owner, request.method, path, request.idempotencyKey]);
    const fingerprint = JSON.stringify([request.body, request.url.search]);
    const previous = replays.get(key);
    if (previous)
      return previous.fingerprint === fingerprint
        ? { ...previous.response, headers: { 'idempotency-replayed': 'true' } }
        : error(409, 'E_SYS_IDEMPOTENCY_KEY_REUSED', path);
    const response = perform();
    if (response.status === 201 || response.status === 204)
      replays.set(key, { fingerprint, response });
    return response;
  }
  return (request) => {
    const path = request.url.pathname;
    if (request.method === 'GET' && path === '/api/v1/public/properties')
      return { status: 200, body: { data: publicProperties, meta: { limit: 20, nextCursor: null, hasMore: false, total: publicProperties.length } } };
    if (request.method === 'GET' && path === '/api/v1/rate-plans')
      return { status: 200, body: ratePlans };
    if (request.method === 'GET' && path === '/api/v1/inventory/availability') {
      const parsed = availabilityQuerySchema.safeParse(
        Object.fromEntries(request.url.searchParams),
      );
      if (!parsed.success) return error(400, 'E_GEN_VALIDATION_FAILED', path);
      const input = parsed.data;
      let nights: number;
      try {
        nights = dates(input.checkIn, input.checkOut).length;
      } catch {
        return error(400, 'E_GEN_VALIDATION_FAILED', path);
      }
      return {
        status: 200,
        body: {
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          nights,
          data: [
            {
              propertyId: input.propertyId,
              roomTypeId: input.roomTypeId ?? 'synthetic-room',
              roomTypeCode: 'STD',
              roomTypeName: 'Synthetic room',
              capacityAdults: 2,
              availableCount: 3,
              soldOut: false,
              minNights: 1,
              maxNights: 365,
              nightlyFrom: 1000000,
              totalFrom: nights * 1000000,
            },
          ],
          meta: { limit: input.limit, nextCursor: null, hasMore: false, total: 1 },
        },
      };
    }
    const owner = context.authenticateGuest?.(request.authorization);
    if (request.method === 'POST' && path === '/api/v1/quotes') {
      if (request.authorization && !owner) return error(401, 'E_AUTH_INVALID_CREDENTIALS', path);
      return idempotent(request, owner, () => {
        const parsed = quoteRequestSchema.safeParse(request.body);
        if (!parsed.success) return error(400, 'E_GEN_VALIDATION_FAILED', path);
        let value: Quote;
        try {
          value = quoted(parsed.data);
        } catch {
          return error(400, 'E_GEN_VALIDATION_FAILED', path);
        }
        quotes.set(value.quoteId, { input: parsed.data, value, owner });
        return { status: 201, body: value };
      });
    }
    const mutation =
      request.method === 'POST' && ['/api/v1/holds', '/api/v1/bookings'].includes(path);
    const detail = /^\/api\/v1\/(holds|bookings)\/([^/]+)$/.exec(path);
    if (!mutation && !detail) return undefined;
    if (
      detail?.[1] === 'bookings' &&
      context.authenticateActor?.(request.authorization)?.guest === false
    )
      return undefined;
    if (!owner) return error(401, 'E_AUTH_INVALID_CREDENTIALS', path);
    if (mutation) return idempotent(request, owner, () => write(request, owner));
    const id = decodeURIComponent(detail![2]!);
    if (request.method === 'GET' && detail![1] === 'bookings') {
      const stored = bookings.get(id);
      if (!stored) return error(404, 'E_GEN_NOT_FOUND', path);
      return stored.owner === owner
        ? { status: 200, body: stored.value }
        : error(404, 'E_GEN_NOT_FOUND', path);
    }
    if (request.method === 'DELETE' && detail![1] === 'holds') {
      return idempotent(request, owner, () => {
        const stored = holds.get(id);
        if (!stored) return error(404, 'E_GEN_NOT_FOUND', path);
        if (stored.owner !== owner) return error(404, 'E_GEN_NOT_FOUND', path);
        if (!request.url.searchParams.get('reason'))
          return error(400, 'E_GEN_VALIDATION_FAILED', path);
        stored.value = {
          ...stored.value,
          status: 'RELEASED',
          releasedAt: new Date().toISOString(),
        };
        return { status: 204 };
      });
    }
    return undefined;
  };
}
