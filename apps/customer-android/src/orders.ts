/**
 * SCR-79 + SCR-80 (HB-113) — đơn của tôi trên Android: lớp thuần, kiểm bằng vitest.
 *
 * Danh sách/chi tiết đọc từ máy chủ (`GET /bookings`, `q` tra theo mã) bằng client của phiên khách. Khi
 * **offline**, màn hình hiện **bản đã tải gần nhất** kèm nhãn "có thể đã cũ" — bản lưu chỉ để đọc, không
 * thay thế máy chủ (mọi lệnh ghi vẫn phải online). Hợp đồng chưa có tuyến PriceSnapshot/Payment cho chi
 * tiết nên màn hình để khung chờ, không bịa số.
 */
import { bookingSummarySchema } from '@pinehill/contracts';
import type { BookingStatus, BookingSummary, ListPage } from '@pinehill/contracts';
import { isApiError } from '@pinehill/api-client';
import { OfflineError, requireOnline, type NetInfoSource } from './netinfo';
import type { KeyValueStorage } from './storage';
import { t, type MessageKey } from './strings';
import { calendarDateLabel } from './calendar-date';

export const ORDERS_CACHE_KEY = 'orders.cache.v1';

export const ORDER_STATUS_KEYS: Readonly<Record<BookingStatus, MessageKey>> = {
  DRAFT: 'orders.status.DRAFT',
  HELD: 'orders.status.HELD',
  PENDING_PAYMENT: 'orders.status.PENDING_PAYMENT',
  CONFIRMED: 'orders.status.CONFIRMED',
  CHECKED_IN: 'orders.status.CHECKED_IN',
  CHECKED_OUT: 'orders.status.CHECKED_OUT',
  CANCELLED: 'orders.status.CANCELLED',
  NO_SHOW: 'orders.status.NO_SHOW',
  EXPIRED: 'orders.status.EXPIRED',
};

export interface OrdersCache {
  readonly cachedAt: string;
  readonly bookings: readonly BookingSummary[];
}

/** Bề mặt API cần cho hai màn — tách ra để test không cần mạng. */
export interface OrdersApi {
  list(query: { q?: string; limit?: number }): Promise<ListPage<BookingSummary>>;
}

export type OrdersOutcome =
  | { readonly kind: 'ready'; readonly bookings: readonly BookingSummary[] }
  | {
      readonly kind: 'offline';
      readonly cached: readonly BookingSummary[];
      readonly cachedAt: string | null;
    }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed'; readonly code: string | null };

/** Lưu bản đọc được để lần sau mở offline vẫn xem được (chỉ để đọc). */
export async function saveOrders(
  storage: KeyValueStorage,
  bookings: readonly BookingSummary[],
  nowMs: number,
): Promise<void> {
  const cache: OrdersCache = { cachedAt: new Date(nowMs).toISOString(), bookings };
  await storage.set(ORDERS_CACHE_KEY, JSON.stringify(cache));
}

/** Đọc bản lưu; dữ liệu hỏng/không đúng dạng thì coi như chưa có (không đoán). */
export async function readOrders(storage: KeyValueStorage): Promise<OrdersCache | null> {
  const raw = await storage.get(ORDERS_CACHE_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  if (!('cachedAt' in parsed) || !('bookings' in parsed)) return null;
  const cachedAt = parsed.cachedAt;
  const entries = parsed.bookings;
  if (typeof cachedAt !== 'string' || !Array.isArray(entries)) return null;
  const bookings = parseBookings(entries);
  return bookings === null ? null : { cachedAt, bookings };
}

/** Chỉ nhận bản lưu khi **mọi** phần tử đúng `bookingSummarySchema`; sai một phần tử thì coi như chưa có. */
function parseBookings(entries: readonly unknown[]): BookingSummary[] | null {
  const bookings: BookingSummary[] = [];
  for (const entry of entries) {
    const result = bookingSummarySchema.safeParse(entry);
    if (!result.success) return null;
    bookings.push(result.data);
  }
  return bookings;
}

/**
 * Đọc danh sách: online thì lấy máy chủ rồi lưu bản mới; **offline** thì trả bản đã tải (kèm mốc) để màn
 * hình hiện nhãn "có thể đã cũ"; chưa từng tải thì báo offline trống.
 */
export async function loadOrders(
  deps: {
    readonly api: OrdersApi;
    readonly net: NetInfoSource;
    readonly storage: KeyValueStorage;
    readonly nowMs: number;
  },
  query: { readonly q?: string } = {},
): Promise<OrdersOutcome> {
  try {
    await requireOnline(deps.net);
  } catch (caught) {
    if (!(caught instanceof OfflineError)) throw caught;
    const cached = await readOrders(deps.storage);
    const offline: OrdersOutcome = {
      kind: 'offline',
      cached: cached?.bookings ?? [],
      cachedAt: cached?.cachedAt ?? null,
    };
    return offline;
  }
  return loadFromServer(deps, query);
}

/** Nhánh online: lấy máy chủ, lưu bản mới rồi trả kết quả; lỗi thì trả mã để màn hình dịch. */
async function loadFromServer(
  deps: {
    readonly api: OrdersApi;
    readonly storage: KeyValueStorage;
    readonly nowMs: number;
  },
  query: { readonly q?: string },
): Promise<OrdersOutcome> {
  try {
    const page = await deps.api.list({
      limit: 20,
      ...(query.q === undefined || query.q.trim() === '' ? {} : { q: query.q.trim() }),
    });
    const bookings = page.data;
    await saveOrders(deps.storage, bookings, deps.nowMs);
    return bookings.length === 0 ? { kind: 'empty' } : { kind: 'ready', bookings };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
}

export interface BalanceRow {
  readonly key: 'paid' | 'balance';
  readonly amount: number;
}

/** Hai dòng tiền khách cần thấy: đã trả và còn phải trả (nguyên văn máy chủ trả). */
export function balanceRows(booking: {
  readonly paidAmount: number;
  readonly balanceDue: number;
}): readonly BalanceRow[] {
  return [
    { key: 'paid', amount: booking.paidAmount },
    { key: 'balance', amount: booking.balanceDue },
  ];
}

/** Kỳ lưu trú một dòng: `24/12/2026 → 26/12/2026 · 2 đêm · 1 phòng`. */
export function stayOf(booking: {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly roomCount: number;
}): string {
  return t('orders.period', {
    checkIn: calendarDateLabel(booking.checkIn),
    checkOut: calendarDateLabel(booking.checkOut),
    nights: booking.nights,
    roomCount: booking.roomCount,
  });
}

/** Khách tra theo mã (SCR-79): khớp không phân biệt hoa thường, bỏ khoảng trắng. */
export function findByCode(
  bookings: readonly BookingSummary[],
  code: string,
): BookingSummary | undefined {
  const wanted = code.trim().toUpperCase();
  return bookings.find((booking) => booking.code.toUpperCase() === wanted);
}

export type OrderDetailOutcome =
  | { readonly kind: 'ready'; readonly booking: BookingSummary }
  | {
      readonly kind: 'offline';
      readonly booking: BookingSummary | null;
      readonly cachedAt: string | null;
    }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'failed'; readonly code: string | null };

/**
 * SCR-80: chi tiết theo **mã** (đúng đường dẫn deep link `booking://<code>`). Offline thì trả bản đã tải
 * (kèm mốc để gắn nhãn "có thể đã cũ"), không có trong bản lưu thì để màn hình báo chưa tải được.
 */
export async function loadOrderDetail(
  deps: {
    readonly api: OrdersApi;
    readonly net: NetInfoSource;
    readonly storage: KeyValueStorage;
    readonly nowMs: number;
  },
  code: string,
): Promise<OrderDetailOutcome> {
  const outcome = await loadOrders(deps, { q: code });
  if (outcome.kind === 'failed') return { kind: 'failed', code: outcome.code };
  if (outcome.kind === 'offline')
    return {
      kind: 'offline',
      booking: findByCode(outcome.cached, code) ?? null,
      cachedAt: outcome.cachedAt,
    };
  const found = findByCode(outcome.kind === 'ready' ? outcome.bookings : [], code);
  return found === undefined ? { kind: 'notFound' } : { kind: 'ready', booking: found };
}

/** Booking đang mở từ kết quả tải chi tiết (kể cả bản offline đã tải); lỗi/không thấy thì `null`. */
export function bookingOf(outcome: OrderDetailOutcome | null): BookingSummary | null {
  if (outcome === null || outcome.kind === 'failed' || outcome.kind === 'notFound') return null;
  return outcome.booking;
}
