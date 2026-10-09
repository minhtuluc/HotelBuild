/**
 * SCR-74 + SCR-75 (HB-086) — chi tiết phòng & gói giá trên Android.
 *
 * Lớp thuần: lấy gói giá công khai (`rate-plans`) và báo giá (`quotes`) — **không** access token. Giá từng
 * đêm hiển thị đúng số máy chủ trả (BR-RATE-17, TC-RATE-21): app **không** nhân lại hệ số, chỉ đọc
 * `nightlyPrice`/`basePrice`/`clamped`. Điều khoản huỷ của gói được hiển thị ngay trên màn này, trước
 * bước xác nhận (HB-087).
 */
import { isApiError } from '@pinehill/api-client';
import { ratePlanCodeSchema } from '@pinehill/contracts';
import type { Quote, QuoteRequest, RatePlanCode, RatePlanPublic } from '@pinehill/contracts';
import { OfflineError, requireOnline, type NetInfoSource } from './netinfo';
import type { PublicJourneyApi } from './public-client';

export interface RoomCriteria {
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly roomCount: number;
}

/** Kênh đặt của web/Android khách (api.md §6.3) — app không tự đổi kênh. */
export const GUEST_CHANNEL_CODE = 'WEB';

export interface RoomNightRow {
  readonly date: string;
  readonly basePrice: number;
  readonly nightlyPrice: number;
  readonly clamped: boolean;
}

/** Bảng đêm: in nguyên số máy chủ trả, không tính lại (BR-RATE-17). */
export function nightsTable(quote: Quote): readonly RoomNightRow[] {
  return quote.nights.map((night) => ({
    date: night.date,
    basePrice: night.basePrice,
    nightlyPrice: night.nightlyPrice,
    clamped: night.clamped,
  }));
}

export interface TotalRow {
  readonly key: 'subtotal' | 'discount' | 'total' | 'deposit';
  readonly amount: number;
}

export function totalsRows(quote: Quote): readonly TotalRow[] {
  return [
    { key: 'subtotal', amount: quote.subtotal },
    { key: 'discount', amount: quote.discountAmount },
    { key: 'total', amount: quote.total },
    { key: 'deposit', amount: quote.depositAmount },
  ];
}

export interface PlanTerms {
  readonly depositPercent: number;
  readonly freeCancelHours: number | null;
  readonly minNights: number;
  readonly maxNights: number;
}

/** Điều khoản gói: mốc huỷ miễn phí có thể chưa công bố (`freeCancelHours` thiếu) — màn hình nói rõ. */
export function planTerms(plan: RatePlanPublic): PlanTerms {
  return {
    depositPercent: plan.depositPercent,
    freeCancelHours: plan.freeCancelHours ?? null,
    minNights: plan.minNights,
    maxNights: plan.maxNights,
  };
}

/** Báo giá đã hết hạn theo mốc máy chủ trả? (màn hình chỉ nhắc, không tự gia hạn). */
export function quoteExpired(quote: Quote, nowMs: number): boolean {
  const expiry = Date.parse(quote.expiresAt);
  return Number.isNaN(expiry) ? true : expiry <= nowMs;
}

/** Thân yêu cầu báo giá dựng từ tiêu chí tìm phòng + gói đang chọn. */
export function quoteRequest(criteria: RoomCriteria, ratePlanCode: RatePlanCode): QuoteRequest {
  return {
    propertyId: criteria.propertyId,
    roomTypeId: criteria.roomTypeId,
    channelCode: GUEST_CHANNEL_CODE,
    ratePlanCode,
    checkIn: criteria.checkIn,
    checkOut: criteria.checkOut,
    adults: criteria.adults,
    children: criteria.children,
    roomCount: criteria.roomCount,
  };
}

function positiveInt(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < min || parsed > max ? null : parsed;
}

function dateValue(value: string | undefined): string | null {
  return value !== undefined && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null;
}

interface GuestCounts {
  readonly adults: number;
  readonly children: number;
  readonly roomCount: number;
}

function countsFrom(one: (key: string) => string | undefined): GuestCounts | null {
  const adults = positiveInt(one('adults'), 1, 20);
  const children = positiveInt(one('children'), 0, 20);
  const roomCount = positiveInt(one('roomCount'), 1, 10);
  if (adults === null || children === null || roomCount === null) return null;
  return { adults, children, roomCount };
}

function stayWithinBounds(checkIn: string, checkOut: string): boolean {
  const nights =
    (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000;
  return Number.isInteger(nights) && nights >= 1 && nights <= 365;
}

/** Tiêu chí đọc từ tham số điều hướng của SCR-73 → SCR-74; thiếu/sai thì trả `null` để màn hình báo. */
export function criteriaFromParams(
  params: Readonly<Record<string, string | string[] | undefined>>,
): RoomCriteria | null {
  const one = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const propertyId = one('propertyId');
  const roomTypeId = one('roomTypeId');
  const checkIn = dateValue(one('checkIn'));
  const checkOut = dateValue(one('checkOut'));
  const counts = countsFrom(one);
  if (
    propertyId === undefined ||
    propertyId === '' ||
    roomTypeId === undefined ||
    roomTypeId === '' ||
    checkIn === null ||
    checkOut === null ||
    counts === null
  )
    return null;
  if (!stayWithinBounds(checkIn, checkOut)) return null;
  return { propertyId, roomTypeId, checkIn, checkOut, ...counts };
}

/** Mã gói do màn trước truyền sang: chỉ nhận khi **đúng** là mã gói công bố (không đoán). */
export function planCodeOf(value: string): RatePlanCode | null {
  const parsed = ratePlanCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type PlansOutcome =
  | { readonly kind: 'offline' }
  | { readonly kind: 'ready'; readonly plans: readonly RatePlanPublic[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed'; readonly code: string | null };

export async function loadPlans(
  deps: { readonly api: PublicJourneyApi; readonly net: NetInfoSource },
  criteria: RoomCriteria,
): Promise<PlansOutcome> {
  try {
    await requireOnline(deps.net);
  } catch (caught) {
    if (caught instanceof OfflineError) return { kind: 'offline' };
    throw caught;
  }
  try {
    const response = await deps.api.listRatePlans({
      propertyId: criteria.propertyId,
      checkIn: criteria.checkIn,
      checkOut: criteria.checkOut,
    });
    const plans = response.data.data;
    return plans.length === 0 ? { kind: 'empty' } : { kind: 'ready', plans };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
}

/** Trạng thái tổng hợp của màn SCR-74/75 — suy từ tiêu chí + kết quả gọi API, không tự tính giá. */
export type DetailView =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'failed'; readonly code: string | null }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly plans: readonly RatePlanPublic[];
      readonly quote: Quote | null;
      readonly expired: boolean;
    };

/** Một chỗ duy nhất suy trạng thái hiển thị (ưu tiên: thiếu tiêu chí → offline → lỗi → rỗng → sẵn sàng). */
function quoteOf(quote: QuoteOutcome | null): Quote | null {
  return quote?.kind === 'ready' ? quote.quote : null;
}

export function detailView(input: {
  readonly criteria: RoomCriteria | null;
  readonly plans: PlansOutcome | null;
  readonly quote: QuoteOutcome | null;
  readonly nowMs: number;
}): DetailView {
  if (input.criteria === null) return { kind: 'invalid' };
  if (input.plans === null) return { kind: 'loading' };
  const plans = input.plans;
  if (plans.kind === 'offline') return { kind: 'offline' };
  if (input.quote?.kind === 'offline') return { kind: 'offline' };
  if (plans.kind === 'failed') return { kind: 'failed', code: plans.code };
  if (plans.kind === 'empty') return { kind: 'empty' };
  const quote = quoteOf(input.quote);
  return {
    kind: 'ready',
    plans: plans.plans,
    quote,
    expired: quote !== null && quoteExpired(quote, input.nowMs),
  };
}

export type QuoteOutcome =
  | { readonly kind: 'offline' }
  | { readonly kind: 'ready'; readonly quote: Quote }
  | { readonly kind: 'failed'; readonly code: string | null };

export async function loadQuote(
  deps: { readonly api: PublicJourneyApi; readonly net: NetInfoSource },
  criteria: RoomCriteria,
  ratePlanCode: RatePlanCode,
): Promise<QuoteOutcome> {
  try {
    await requireOnline(deps.net);
  } catch (caught) {
    if (caught instanceof OfflineError) return { kind: 'offline' };
    throw caught;
  }
  try {
    const response = await deps.api.quote(quoteRequest(criteria, ratePlanCode));
    return { kind: 'ready', quote: response.data };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
}
