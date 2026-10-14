import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { BookingSummary } from '@pinehill/contracts';
import {
  ORDERS_CACHE_KEY,
  loadOrderDetail,
  balanceRows,
  findByCode,
  loadOrders,
  readOrders,
  saveOrders,
  stayOf,
  type OrdersApi,
} from '../src/orders';
import { memoryStorage } from '../src/storage';

// The real catalog loads ui-native's barrel. Node cannot parse native host Flow bindings.
// Only those bindings are substituted; stayOf, translation, cache and API logic remain real.
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View' }));

const online = { getConnected: async () => true };
const offline = { getConnected: async () => false };

function booking(overrides: Partial<BookingSummary> = {}): BookingSummary {
  return {
    id: 'b1',
    code: 'PH-2601-00001',
    seq: 1,
    status: 'CONFIRMED',
    guestId: 'g1',
    propertyId: 'p1',
    roomTypeId: 'rt1',
    ratePlanId: 'FLEX7',
    channelId: 'c1',
    checkIn: '2026-12-24',
    checkOut: '2026-12-26',
    nights: 2,
    adults: 2,
    children: 0,
    roomCount: 1,
    totalAmount: 2_000_000,
    depositPercent: 30,
    depositAmount: 600_000,
    paidAmount: 600_000,
    refundedAmount: 0,
    balanceDue: 1_400_000,
    penaltyAmount: 0,
    currency: 'VND',
    rescheduleCount: 0,
    holdExpiresAt: null,
    oversold: false,
    priceLocked: false,
    duplicateSuspected: false,
    channelPolicyCode: null,
    note: null,
    createdBy: 'g1',
    createdAt: '2026-12-01T00:00:00.000Z',
    ...overrides,
  };
}

const api = (bookings: readonly BookingSummary[] = [booking()]): OrdersApi => ({
  list: async (query) =>
    Promise.resolve({
      data: query.q === undefined ? bookings : bookings.filter((item) => item.code === query.q),
      meta: { limit: 20, nextCursor: null, hasMore: false, total: bookings.length },
    }),
});

describe('SCR-79/SCR-80 đơn của tôi trên Android (HB-113)', () => {
  it('online: lấy máy chủ rồi lưu bản đã tải; rỗng thì báo trạng thái riêng', async () => {
    const storage = memoryStorage();
    const outcome = await loadOrders(
      { api: api(), net: online, storage, nowMs: Date.parse('2026-12-02T00:00:00.000Z') },
      {},
    );
    expect(outcome.kind).toBe('ready');
    const cached = await readOrders(storage);
    expect(cached?.cachedAt).toBe('2026-12-02T00:00:00.000Z');
    expect(cached?.bookings).toHaveLength(1);

    const empty = await loadOrders({ api: api([]), net: online, storage, nowMs: 0 }, {});
    expect(empty).toEqual({ kind: 'empty' });
    expect(await storage.get(ORDERS_CACHE_KEY)).not.toBeNull();
  });

  it('offline: trả bản đã tải kèm mốc để màn hình gắn nhãn "có thể đã cũ" (AC1)', async () => {
    const storage = memoryStorage();
    await saveOrders(storage, [booking()], Date.parse('2026-12-02T00:00:00.000Z'));
    let calls = 0;
    const counting: OrdersApi = {
      list: async () => {
        calls += 1;
        return { data: [], meta: { limit: 20, nextCursor: null, hasMore: false, total: 0 } };
      },
    };
    const outcome = await loadOrders({ api: counting, net: offline, storage, nowMs: 0 }, {});
    expect(outcome).toEqual({
      kind: 'offline',
      cached: [booking()],
      cachedAt: '2026-12-02T00:00:00.000Z',
    });
    expect(calls).toBe(0);
  });

  it('offline mà chưa từng tải thì báo trống, không bịa dữ liệu', async () => {
    const outcome = await loadOrders(
      { api: api(), net: offline, storage: memoryStorage(), nowMs: 0 },
      {},
    );
    expect(outcome).toEqual({ kind: 'offline', cached: [], cachedAt: null });
  });

  it('bản lưu hỏng thì coi như chưa có', async () => {
    const storage = memoryStorage();
    await storage.set(ORDERS_CACHE_KEY, '{không-phải-json');
    expect(await readOrders(storage)).toBeNull();
    await storage.set(ORDERS_CACHE_KEY, JSON.stringify({ bookings: [] }));
    expect(await readOrders(storage)).toBeNull();
  });

  it('lỗi máy chủ thì trả mã để màn hình hiện câu chữ theo mã', async () => {
    const failing: OrdersApi = {
      list: async () => {
        throw new ApiError({
          kind: 'http',
          message: 'Phiên hết hạn',
          status: 401,
          code: 'E_AUTH_INVALID_CREDENTIALS',
        });
      },
    };
    expect(
      await loadOrders({ api: failing, net: online, storage: memoryStorage(), nowMs: 0 }, {}),
    ).toEqual({ kind: 'failed', code: 'E_AUTH_INVALID_CREDENTIALS' });
  });

  it('chi tiết theo mã: online trả bản của mã đó, không có thì báo không tìm thấy (AC1)', async () => {
    const deps = { api: api(), net: online, storage: memoryStorage(), nowMs: 0 };
    const found = await loadOrderDetail(deps, 'PH-2601-00001');
    expect(found.kind).toBe('ready');
    expect(await loadOrderDetail(deps, 'PH-9999-00000')).toEqual({ kind: 'notFound' });
  });

  it('chi tiết offline: trả bản đã tải của đúng mã, kèm mốc để gắn nhãn cũ (AC1)', async () => {
    const storage = memoryStorage();
    await saveOrders(storage, [booking()], Date.parse('2026-12-02T00:00:00.000Z'));
    const offlineDeps = { api: api(), net: offline, storage, nowMs: 0 };
    expect(await loadOrderDetail(offlineDeps, 'PH-2601-00001')).toEqual({
      kind: 'offline',
      booking: booking(),
      cachedAt: '2026-12-02T00:00:00.000Z',
    });
    expect(await loadOrderDetail(offlineDeps, 'PH-9999-00000')).toEqual({
      kind: 'offline',
      booking: null,
      cachedAt: '2026-12-02T00:00:00.000Z',
    });
  });

  it('tra theo mã, dòng tiền và kỳ lưu trú', () => {
    expect(findByCode([booking()], ' ph-2601-00001 ')?.id).toBe('b1');
    expect(findByCode([booking()], 'PH-9999-00000')).toBeUndefined();
    expect(balanceRows(booking())).toEqual([
      { key: 'paid', amount: 600_000 },
      { key: 'balance', amount: 1_400_000 },
    ]);
    expect(stayOf(booking())).toBe('24/12/2026 → 26/12/2026 · 2 đêm · 1 phòng');
  });

  it.each([
    ['2024-02-29', '2024-03-01', '29/02/2024 → 01/03/2024 · 42 đêm · 3 phòng'],
    ['2026-12-31', '2027-01-01', '31/12/2026 → 01/01/2027 · 42 đêm · 3 phòng'],
    ['2026-03-08', '2026-03-09', '08/03/2026 → 09/03/2026 · 42 đêm · 3 phòng'],
    ['2026-11-01', '2026-11-02', '01/11/2026 → 02/11/2026 · 42 đêm · 3 phòng'],
  ])(
    'formats calendar dates %s without calculating nights or changing input',
    (checkIn, checkOut, expected) => {
      const stay = Object.freeze({ checkIn, checkOut, nights: 42, roomCount: 3 });
      expect(stayOf(stay)).toBe(expected);
      expect(stay).toEqual({ checkIn, checkOut, nights: 42, roomCount: 3 });
    },
  );
});
