/**
 * SCR-72 + SCR-73 (HB-085) — tìm phòng & kết quả trên Android.
 *
 * Lớp thuần, kiểm bằng Vitest: kiểm tiêu chí **tại chỗ** (không gọi API khi thiếu/sai), chặn khi **offline**
 * (`requireOnline` — AC1 "cần kết nối"), gọi `availability` **công khai** (không access token, ADR-018) rồi
 * ánh xạ kết quả cho màn hình. Máy chủ là nguồn duy nhất của tồn/giá; app không tự tính lại.
 */
import { isApiError } from '@pinehill/api-client';
import type { Availability, AvailabilityItem } from '@pinehill/contracts';
import { OfflineError, requireOnline, type NetInfoSource } from './netinfo';
import type { PublicJourneyApi } from './public-client';

export interface SearchCriteria {
  readonly propertyId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly roomCount: number;
}

export type SearchIssue = 'PROPERTY' | 'CHECK_IN' | 'CHECK_OUT' | 'ORDER' | 'GUESTS';

export const EMPTY_CRITERIA: SearchCriteria = {
  propertyId: '',
  checkIn: '',
  checkOut: '',
  adults: 2,
  children: 0,
  roomCount: 1,
};

const DAY_MS = 86_400_000;

/** Số đêm giữa hai mốc; `null` khi mốc không hợp lệ hoặc ngoài 1…365 đêm (như máy chủ). */
export function nightsBetween(checkIn: string, checkOut: string): number | null {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const nights = (end - start) / DAY_MS;
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) return null;
  return nights;
}

/** Mốc ngày hợp lệ dạng `YYYY-MM-DD` (kiểm tại chỗ; máy chủ vẫn kiểm lại). */
function validDate(value: string): boolean {
  return value !== '' && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function guestsOutOfBounds(criteria: SearchCriteria): boolean {
  return (
    criteria.adults < 1 ||
    criteria.adults > 20 ||
    criteria.children < 0 ||
    criteria.children > 20 ||
    criteria.roomCount < 1 ||
    criteria.roomCount > 10
  );
}

/** Lỗi tiêu chí đầu tiên — chặn trước khi gọi mạng. */
export function searchIssue(criteria: SearchCriteria): SearchIssue | null {
  if (criteria.propertyId.trim() === '') return 'PROPERTY';
  if (!validDate(criteria.checkIn)) return 'CHECK_IN';
  if (!validDate(criteria.checkOut)) return 'CHECK_OUT';
  if (nightsBetween(criteria.checkIn, criteria.checkOut) === null) return 'ORDER';
  return guestsOutOfBounds(criteria) ? 'GUESTS' : null;
}

export interface SearchRow {
  readonly roomTypeId: string;
  readonly roomTypeCode: string;
  readonly name: string;
  readonly availableCount: number;
  readonly soldOut: boolean;
  readonly capacityAdults: number;
  readonly minNights: number;
  readonly maxNights: number;
  readonly nightlyFrom: number;
  readonly totalFrom: number;
}

/** Một dòng kết quả: nguyên văn số máy chủ trả (số phòng còn, giá từ, tổng từ). */
export function searchRows(availability: Availability): readonly SearchRow[] {
  return availability.data.map((item: AvailabilityItem) => ({
    roomTypeId: item.roomTypeId,
    roomTypeCode: item.roomTypeCode,
    name: item.roomTypeName,
    availableCount: item.availableCount,
    soldOut: item.soldOut,
    capacityAdults: item.capacityAdults,
    minNights: item.minNights,
    maxNights: item.maxNights,
    nightlyFrom: item.nightlyFrom,
    totalFrom: item.totalFrom,
  }));
}

export type SearchOutcome =
  | { readonly kind: 'offline' }
  | { readonly kind: 'ready'; readonly availability: Availability }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed'; readonly code: string | null };

export interface SearchDeps {
  readonly api: PublicJourneyApi;
  readonly net: NetInfoSource;
}

/**
 * Chạy tìm phòng: offline → `offline` (không gọi mạng); máy chủ trả danh sách rỗng → `empty`; lỗi khác →
 * `failed` kèm mã lỗi để màn hình hiện câu chữ theo mã (không hiện chi tiết kỹ thuật).
 */
export async function runSearch(
  deps: SearchDeps,
  criteria: SearchCriteria,
): Promise<SearchOutcome> {
  try {
    await requireOnline(deps.net);
  } catch (caught) {
    if (caught instanceof OfflineError) return { kind: 'offline' };
    throw caught;
  }
  try {
    const response = await deps.api.availability({ ...criteria });
    const availability = response.data;
    return availability.data.length === 0 ? { kind: 'empty' } : { kind: 'ready', availability };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
}

/** `1.222.000` — tiền VND nguyên, nhóm nghìn bằng dấu chấm (Hermes không cần Intl). */
export function formatVnd(amount: number): string {
  if (!Number.isInteger(amount)) throw new RangeError('Tiền phải là số nguyên VND (BR-GEN-01).');
  const sign = amount < 0 ? '-' : '';
  const digits = String(Math.abs(amount));
  let grouped = '';
  for (let index = 0; index < digits.length; index += 1) {
    const fromEnd = digits.length - index;
    grouped += digits[index];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) grouped += '.';
  }
  return `${sign}${grouped}`;
}
