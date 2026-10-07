import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createJourneyApiClient } from '../src/client.js';
import { availability, booking, bookingInput } from './journey-fixtures.js';
import { createBookingApi, createInventoryApi } from '@pinehill/api-client';
let token: string | null = null;
beforeEach(() => {
  vi.unstubAllGlobals();
  token = null;
});
test('browser client routes public requests to own BFF without bearer', async () => {
  const calls: { url: string; headers: Headers }[] = [];
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return Response.json(availability);
  });
  const api = createJourneyApiClient({
    baseUrl: 'https://guest.test',
    session: { getAccessToken: () => token, onUnauthorized: async () => false },
  });
  const result = await createInventoryApi(api).availability({
    propertyId: 'synthetic-property',
    checkIn: '2026-10-10',
    checkOut: '2026-10-11',
    adults: 2,
    children: 0,
    roomCount: 1,
  });
  expect(result.data.data[0]?.nightlyFrom).toBe(1000000);
  expect(calls[0]?.url).toContain('https://guest.test/api/session/journey/inventory/availability?');
  expect(calls[0]?.headers.get('authorization')).toBeNull();
  expect(calls[0]?.headers.get('x-session-request')).toBe('1');
});
test('authenticated401 rotates through session hook and replays exactsame key once', async () => {
  token = 'old-synthetic-token';
  const keys: string[] = [];
  const tokens: (string | null)[] = [];
  const rejected: (string | undefined)[] = [];
  vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    keys.push(headers.get('idempotency-key') ?? '');
    tokens.push(headers.get('authorization'));
    return keys.length === 1
      ? Response.json(
          {
            code: 'E_AUTH_INVALID_CREDENTIALS',
            message: 'Expired',
            traceId: 'trace',
            timestamp: '2026-10-07T00:00:00.000Z',
            path: '/bookings',
          },
          { status: 401 },
        )
      : Response.json(booking, { status: 201 });
  });
  const api = createJourneyApiClient({
    baseUrl: 'https://guest.test',
    session: {
      getAccessToken: () => token,
      onUnauthorized: async (old) => {
        rejected.push(old);
        token = 'new-synthetic-token';
        return true;
      },
    },
  });
  expect((await createBookingApi(api).create(bookingInput)).data.duplicateSuspected).toBe(true);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[0]).toMatch(/^[a-f0-9-]{36}$/);
  expect(tokens).toEqual(['Bearer old-synthetic-token', 'Bearer new-synthetic-token']);
  expect(rejected).toEqual(['old-synthetic-token']);
});
test('cannot use a path-bearing or credential-bearing app origin', () => {
  for (const baseUrl of [
    'https://guest.test/path',
    'https://user:pass@guest.test',
    'https://guest.test/?x=1',
  ])
    expect(() =>
      createJourneyApiClient({
        baseUrl,
        session: { getAccessToken: () => null, onUnauthorized: async () => false },
      }),
    ).toThrow();
});

afterEach(() => vi.unstubAllGlobals());
test('browser cannot point its bearer at another app origin', () => {
  vi.stubGlobal('location', { origin: 'https://guest.test' });
  expect(() =>
    createJourneyApiClient({
      baseUrl: 'https://other.test',
      session: { getAccessToken: () => null, onUnauthorized: async () => false },
    }),
  ).toThrow('current app origin');
});
test('accepts the async access getter supplied by the real SessionClient', async () => {
  let authorization: string | null = null;
  vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get('authorization');
    return Response.json(booking, { status: 201 });
  });
  const api = createJourneyApiClient({
    baseUrl: 'https://guest.test',
    session: {
      getAccessToken: async () => 'synthetic-async-access',
      onUnauthorized: async () => false,
    },
  });
  expect((await createBookingApi(api).create(bookingInput)).status).toBe(201);
  expect(authorization).toBe('Bearer synthetic-async-access');
});
