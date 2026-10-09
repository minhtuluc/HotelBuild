import { describe, expect, it } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import type { Quote, RatePlanPublic } from '@pinehill/contracts';
import { createPublicJourneyApi } from '../src/public-client';
import {
  GUEST_CHANNEL_CODE,
  criteriaFromParams,
  detailView,
  loadPlans,
  loadQuote,
  nightsTable,
  planCodeOf,
  planTerms,
  quoteExpired,
  quoteRequest,
  totalsRows,
  type RoomCriteria,
} from '../src/room-detail';

function clientWith(fetchImpl: typeof fetch): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test/api/v1',
    fetchImpl,
    createId: () => '11111111-1111-4111-8111-111111111111',
    maxAttempts: 1,
    sleep: async () => undefined,
  });
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const CRITERIA: RoomCriteria = {
  propertyId: 'synthetic-property',
  roomTypeId: 'rt-1',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  adults: 2,
  children: 0,
  roomCount: 1,
};

const online = { getConnected: async () => true };
const offline = { getConnected: async () => false };

const plan = (overrides: Partial<RatePlanPublic> = {}): RatePlanPublic => ({
  code: 'FLEX7',
  name: 'Linh hoạt 7 ngày',
  minNights: 1,
  maxNights: 365,
  depositPercent: 30,
  freeCancelHours: 48,
  ...overrides,
});

/** Báo giá cố ý có `nightlyPrice` KHÁC tích các hệ số để chứng minh app không tự tính lại. */
const QUOTE: Quote = {
  quoteId: 'q1',
  channelCode: 'WEB',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: [
    {
      date: '2026-12-24',
      basePrice: 1_000_000,
      seasonMultiplier: 1.2,
      weekendMultiplier: 1,
      occupancyMultiplier: 1,
      losMultiplier: 1,
      channelMultiplier: 0.9,
      clamped: false,
      nightlyPrice: 999_000,
    },
    {
      date: '2026-12-25',
      basePrice: 1_000_000,
      seasonMultiplier: 1.2,
      weekendMultiplier: 1,
      occupancyMultiplier: 1,
      losMultiplier: 1,
      channelMultiplier: 0.9,
      clamped: true,
      nightlyPrice: 1_111_000,
    },
  ],
  subtotal: 2_000_000,
  discountAmount: 0,
  total: 2_110_000,
  currency: 'VND',
  warnings: [],
  depositPercent: 30,
  depositAmount: 633_000,
  engineVersion: 'synthetic-v1',
  quotedAt: '2026-12-01T00:00:00.000Z',
  expiresAt: '2026-12-01T00:15:00.000Z',
};

describe('SCR-74/SCR-75 chi tiết phòng & gói giá trên Android (HB-086)', () => {
  it('bảng đêm in nguyên số máy chủ trả, không nhân lại hệ số (BR-RATE-17)', () => {
    const rows = nightsTable(QUOTE);
    expect(rows).toEqual([
      { date: '2026-12-24', basePrice: 1_000_000, nightlyPrice: 999_000, clamped: false },
      { date: '2026-12-25', basePrice: 1_000_000, nightlyPrice: 1_111_000, clamped: true },
    ]);
    // 1.000.000 × các hệ số = 1.080.000 ≠ 999.000 ⇒ màn hình phải dùng đúng nightlyPrice của máy chủ.
    expect(rows[0]?.nightlyPrice).not.toBe(1_080_000);
  });

  it('tổng hợp tiền lấy nguyên bốn con số máy chủ trả', () => {
    expect(totalsRows(QUOTE)).toEqual([
      { key: 'subtotal', amount: 2_000_000 },
      { key: 'discount', amount: 0 },
      { key: 'total', amount: 2_110_000 },
      { key: 'deposit', amount: 633_000 },
    ]);
  });

  it('điều khoản huỷ: mốc miễn phí có thì lấy, thiếu thì trả null để màn hình nói rõ', () => {
    expect(planTerms(plan())).toEqual({
      depositPercent: 30,
      freeCancelHours: 48,
      minNights: 1,
      maxNights: 365,
    });
    expect(planTerms(plan({ freeCancelHours: undefined })).freeCancelHours).toBeNull();
  });

  it('nhận diện báo giá hết hạn theo mốc máy chủ', () => {
    const before = Date.parse('2026-12-01T00:14:59.000Z');
    const after = Date.parse('2026-12-01T00:15:00.000Z');
    expect(quoteExpired(QUOTE, before)).toBe(false);
    expect(quoteExpired(QUOTE, after)).toBe(true);
  });

  it('thân yêu cầu báo giá đúng kênh khách, đúng gói và đúng kỳ', () => {
    expect(quoteRequest(CRITERIA, 'SAVER3')).toEqual({
      propertyId: 'synthetic-property',
      roomTypeId: 'rt-1',
      channelCode: GUEST_CHANNEL_CODE,
      ratePlanCode: 'SAVER3',
      checkIn: '2026-12-24',
      checkOut: '2026-12-26',
      adults: 2,
      children: 0,
      roomCount: 1,
    });
    expect(planCodeOf('SAVER3')).toBe('SAVER3');
    expect(planCodeOf('KHÔNG-CÓ')).toBeNull();
  });

  it('đọc tiêu chí từ tham số điều hướng, sai thì trả null', () => {
    const params = {
      propertyId: 'synthetic-property',
      roomTypeId: 'rt-1',
      checkIn: '2026-12-24',
      checkOut: '2026-12-26',
      adults: '2',
      children: '0',
      roomCount: '1',
    };
    expect(criteriaFromParams(params)).toEqual(CRITERIA);
    expect(criteriaFromParams({ ...params, checkOut: '2026-12-24' })).toBeNull();
    expect(criteriaFromParams({ ...params, adults: '0' })).toBeNull();
    expect(criteriaFromParams({ ...params, propertyId: undefined })).toBeNull();
  });

  it('suy trạng thái hiển thị theo thứ tự ưu tiên, không tự tính giá', () => {
    const ready = { kind: 'ready', plans: [plan()] } as const;
    expect(detailView({ criteria: null, plans: null, quote: null, nowMs: 0 })).toEqual({
      kind: 'invalid',
    });
    expect(detailView({ criteria: CRITERIA, plans: null, quote: null, nowMs: 0 })).toEqual({
      kind: 'loading',
    });
    expect(
      detailView({ criteria: CRITERIA, plans: { kind: 'offline' }, quote: null, nowMs: 0 }),
    ).toEqual({ kind: 'offline' });
    expect(
      detailView({
        criteria: CRITERIA,
        plans: { kind: 'failed', code: 'E_X' },
        quote: null,
        nowMs: 0,
      }),
    ).toEqual({ kind: 'failed', code: 'E_X' });
    expect(
      detailView({ criteria: CRITERIA, plans: { kind: 'empty' }, quote: null, nowMs: 0 }),
    ).toEqual({ kind: 'empty' });
    const before = Date.parse('2026-12-01T00:14:59.000Z');
    expect(
      detailView({
        criteria: CRITERIA,
        plans: ready,
        quote: { kind: 'ready', quote: QUOTE },
        nowMs: before,
      }),
    ).toEqual({ kind: 'ready', plans: ready.plans, quote: QUOTE, expired: false });
    const late = detailView({
      criteria: CRITERIA,
      plans: ready,
      quote: { kind: 'ready', quote: QUOTE },
      nowMs: Date.parse('2026-12-01T00:15:00.000Z'),
    });
    expect(late.kind === 'ready' && late.expired).toBe(true);
  });

  it('offline thì báo cần kết nối và KHÔNG gọi mạng', async () => {
    let calls = 0;
    const api = createPublicJourneyApi(
      clientWith(async () => {
        calls += 1;
        return json({ data: [], meta: { limit: 20, nextCursor: null, hasMore: false } });
      }),
    );
    expect(await loadPlans({ api, net: offline }, CRITERIA)).toEqual({ kind: 'offline' });
    expect(await loadQuote({ api, net: offline }, CRITERIA, 'FLEX7')).toEqual({ kind: 'offline' });
    expect(calls).toBe(0);
  });

  it('lấy gói giá và báo giá qua API công khai (không access token)', async () => {
    const seen: { url: string; body: string }[] = [];
    const api = createPublicJourneyApi(
      clientWith(async (input, init) => {
        const request = new Request(input, init);
        const url = request.url;
        const body = request.method === 'GET' ? '' : await request.clone().text();
        seen.push({ url, body });
        if (url.includes('/rate-plans'))
          return json({
            data: [plan(), plan({ code: 'SAVER3', freeCancelHours: undefined })],
            meta: { limit: 20, nextCursor: null, hasMore: false, total: 2 },
          });
        return json(QUOTE, 201);
      }),
    );
    const plans = await loadPlans({ api, net: online }, CRITERIA);
    expect(plans.kind).toBe('ready');
    if (plans.kind === 'ready') expect(plans.plans).toHaveLength(2);

    const quote = await loadQuote({ api, net: online }, CRITERIA, 'SAVER3');
    expect(quote.kind).toBe('ready');
    const request = seen.find((call) => call.url.includes('/quotes'));
    expect(request?.body).toContain('"ratePlanCode":"SAVER3"');
    expect(request?.body).toContain('"roomTypeId":"rt-1"');
    expect(request?.url).not.toContain('token');
  });

  it('lỗi máy chủ thì trả mã để màn hình hiện câu chữ theo mã', async () => {
    const api = createPublicJourneyApi(
      clientWith(async () =>
        json(
          {
            code: 'E_RATE_PLAN_NOT_FOUND',
            message: 'Không có gói',
            traceId: 't1',
            timestamp: '2026-12-01T00:00:00.000Z',
            path: '/api/v1/rate-plans',
          },
          404,
        ),
      ),
    );
    expect(await loadPlans({ api, net: online }, CRITERIA)).toMatchObject({ kind: 'failed' });
  });
});
