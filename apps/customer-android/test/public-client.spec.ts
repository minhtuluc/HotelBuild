/** HB-084: client công khai journey khách — không gắn access token khi chưa đăng nhập (ADR-018). */
import { describe, expect, it } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { createPublicJourneyApi, type PublicJourneyApi } from '../src/public-client';

interface Captured {
  url: string;
  headers: Record<string, string>;
}

const AVAILABILITY = {
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: 2,
  channelCode: 'WEB',
  data: [
    {
      propertyId: 'p1',
      roomTypeId: 'rt1',
      roomTypeCode: 'STD',
      roomTypeName: 'Standard',
      capacityAdults: 2,
      availableCount: 4,
      soldOut: false,
      minNights: 1,
      maxNights: 30,
      nightlyFrom: 1_421_000,
      totalFrom: 2_842_000,
    },
  ],
  meta: { limit: 20, nextCursor: null, hasMore: false },
};

const QUOTE = {
  quoteId: 'q1',
  channelCode: 'WEB',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: [
    {
      date: '2026-12-24',
      basePrice: 650_000,
      seasonMultiplier: 2,
      weekendMultiplier: 1,
      occupancyMultiplier: 1.15,
      losMultiplier: 0.95,
      channelMultiplier: 1,
      clamped: false,
      nightlyPrice: 1_421_000,
    },
  ],
  subtotal: 1_421_000,
  discountAmount: 0,
  total: 1_421_000,
  currency: 'VND',
  warnings: [],
  depositPercent: 30,
  depositAmount: 426_300,
  engineVersion: 'pricing-1.0.0',
  quotedAt: '2026-09-19T03:12:44Z',
  expiresAt: '2026-09-19T03:27:44Z',
};

function harness(): { api: PublicJourneyApi; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    const entries: readonly (readonly [string, string])[] =
      raw === undefined
        ? []
        : raw instanceof Headers
          ? Array.from(raw.entries())
          : Array.isArray(raw)
            ? raw.map(([key, value]) => [key, String(value)] as const)
            : Object.entries(raw);
    for (const [key, value] of entries) headers[key] = String(value);
    calls.push({ url, headers });
    const path = new URL(url).pathname;
    const body = path.endsWith('/quotes')
      ? QUOTE
      : path.endsWith('/rate-plans')
        ? { data: [], meta: { limit: 20, nextCursor: null, hasMore: false, total: 0 } }
        : AVAILABILITY;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new ApiClient({
    baseUrl: 'http://127.0.0.1:9/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    fetchImpl,
    sleep: async () => undefined,
  });
  return { api: createPublicJourneyApi(client), calls };
}

describe('createPublicJourneyApi', () => {
  it('tìm phòng công khai không gửi Authorization và không gửi Idempotency-Key', async () => {
    const { api, calls } = harness();
    const result = await api.availability({
      propertyId: 'p1',
      checkIn: '2026-12-24',
      checkOut: '2026-12-26',
      adults: 2,
      children: 0,
      roomCount: 1,
      channelCode: 'WEB',
    });
    expect(result.data.data[0]?.availableCount).toBe(4);
    const seen = calls[0];
    expect(seen?.headers.authorization).toBeUndefined();
    expect(seen?.headers['idempotency-key']).toBeUndefined();
    expect(seen?.url).toContain('/inventory/availability');
  });

  it('báo giá công khai mang Idempotency-Key nhưng không có token', async () => {
    const { api, calls } = harness();
    const quote = await api.quote({
      propertyId: 'p1',
      roomTypeId: 'rt1',
      channelCode: 'WEB',
      ratePlanCode: 'FLEX7',
      checkIn: '2026-12-24',
      checkOut: '2026-12-26',
      adults: 2,
      children: 0,
      roomCount: 1,
    });
    expect(quote.data.quoteId).toBe('q1');
    expect(calls[0]?.headers.authorization).toBeUndefined();
    expect(calls[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('xem gói giá công khai không có token', async () => {
    const { api, calls } = harness();
    await api.listRatePlans({ propertyId: 'p1' });
    expect(calls[0]?.headers.authorization).toBeUndefined();
    expect(calls[0]?.url).toContain('/rate-plans');
  });
});
