import { describe, expect, it } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { createPublicJourneyApi } from '../src/public-client';
import {
  EMPTY_CRITERIA,
  formatVnd,
  nightsBetween,
  runSearch,
  searchIssue,
  searchRows,
  type SearchCriteria,
} from '../src/search';

function clientWith(fetchImpl: typeof fetch): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test/api/v1',
    fetchImpl,
    createId: () => '11111111-1111-4111-8111-111111111111',
    maxAttempts: 1,
    sleep: async () => undefined,
  });
}

const CRITERIA: SearchCriteria = {
  propertyId: 'synthetic-property',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  adults: 2,
  children: 0,
  roomCount: 1,
};

const availabilityBody = (data: readonly unknown[]) => ({
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: 2,
  data,
  meta: { limit: 20, nextCursor: null, hasMore: false, total: data.length },
});

const row = (overrides: Record<string, unknown> = {}) => ({
  propertyId: 'synthetic-property',
  roomTypeId: 'rt-1',
  roomTypeCode: 'STD',
  roomTypeName: 'Phòng tiêu chuẩn',
  capacityAdults: 2,
  availableCount: 3,
  soldOut: false,
  minNights: 1,
  maxNights: 365,
  nightlyFrom: 1000000,
  totalFrom: 2000000,
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const online = { getConnected: async () => true };
const offline = { getConnected: async () => false };

describe('SCR-72/SCR-73 tìm phòng trên Android (HB-085)', () => {
  it('kiểm tiêu chí tại chỗ trước khi gọi mạng', () => {
    expect(searchIssue(EMPTY_CRITERIA)).toBe('PROPERTY');
    expect(searchIssue({ ...CRITERIA, checkIn: '' })).toBe('CHECK_IN');
    expect(searchIssue({ ...CRITERIA, checkOut: '' })).toBe('CHECK_OUT');
    expect(searchIssue({ ...CRITERIA, checkOut: '2026-12-24' })).toBe('ORDER');
    expect(searchIssue({ ...CRITERIA, checkOut: '2030-12-26' })).toBe('ORDER');
    expect(searchIssue({ ...CRITERIA, adults: 0 })).toBe('GUESTS');
    expect(searchIssue({ ...CRITERIA, roomCount: 11 })).toBe('GUESTS');
    expect(searchIssue(CRITERIA)).toBeNull();
    expect(nightsBetween('2026-12-24', '2026-12-26')).toBe(2);
    expect(nightsBetween('2026-12-26', '2026-12-24')).toBeNull();
  });

  it('offline thì trả "cần kết nối" và KHÔNG gọi mạng (AC1)', async () => {
    let calls = 0;
    const api = createPublicJourneyApi(
      clientWith(async () => {
        calls += 1;
        return jsonResponse(availabilityBody([]));
      }),
    );
    expect(await runSearch({ api, net: offline }, CRITERIA)).toEqual({ kind: 'offline' });
    expect(calls).toBe(0);
  });

  it('trả danh sách phòng còn chỗ nguyên văn số máy chủ (AC1)', async () => {
    const api = createPublicJourneyApi(
      clientWith(async () =>
        jsonResponse(
          availabilityBody([
            row(),
            row({
              roomTypeId: 'rt-2',
              roomTypeName: 'Phòng gia đình',
              availableCount: 0,
              soldOut: true,
              nightlyFrom: 1500000,
              totalFrom: 3000000,
            }),
          ]),
        ),
      ),
    );
    const outcome = await runSearch({ api, net: online }, CRITERIA);
    expect(outcome.kind).toBe('ready');
    if (outcome.kind !== 'ready') return;
    const rows = searchRows(outcome.availability);
    expect(rows.map((item) => [item.name, item.availableCount, item.soldOut])).toEqual([
      ['Phòng tiêu chuẩn', 3, false],
      ['Phòng gia đình', 0, true],
    ]);
    expect(rows[0]?.nightlyFrom).toBe(1000000);
    expect(rows[1]?.totalFrom).toBe(3000000);
  });

  it('không có loại phòng nào thì trả trạng thái rỗng riêng', async () => {
    const api = createPublicJourneyApi(clientWith(async () => jsonResponse(availabilityBody([]))));
    expect(await runSearch({ api, net: online }, CRITERIA)).toEqual({ kind: 'empty' });
  });

  it('lỗi máy chủ thì trả mã để màn hình hiện câu chữ theo mã', async () => {
    const api = createPublicJourneyApi(
      clientWith(async () =>
        jsonResponse(
          {
            code: 'E_RBAC_FORBIDDEN',
            message: 'Không đủ quyền',
            traceId: 't1',
            timestamp: '2026-10-01T00:00:00.000Z',
            path: '/api/v1/inventory/availability',
          },
          403,
        ),
      ),
    );
    expect(await runSearch({ api, net: online }, CRITERIA)).toEqual({
      kind: 'failed',
      code: 'E_RBAC_FORBIDDEN',
    });
  });

  it('định dạng tiền VND nguyên cho Hermes (không cần Intl)', () => {
    expect(formatVnd(0)).toBe('0');
    expect(formatVnd(999)).toBe('999');
    expect(formatVnd(1000)).toBe('1.000');
    expect(formatVnd(1222000)).toBe('1.222.000');
    expect(formatVnd(-1000)).toBe('-1.000');
    expect(() => formatVnd(1.5)).toThrow(RangeError);
  });
});
