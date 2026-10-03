/**
 * Bản nhập và kiểm tra phía giao diện cho biểu mẫu tạo loại phòng (SCR-20).
 * Thuần, không React — kiểm được bằng vitest; **không** phải nguồn chân lý: máy chủ vẫn kiểm lại
 * (BR-RATE-03, BR-RATE-04).
 */
import type { RoomTypeCreateRequest } from '@pinehill/contracts';
import { toMoney } from '../../../lib/money';

export interface RoomTypeDraft {
  propertyId: string;
  code: string;
  capacityAdults: string;
  capacityChildren: string;
  basePrice: string;
  minPrice: string;
  maxPrice: string;
  bedCount: string;
  allowShared: boolean;
}

export const EMPTY_ROOM_TYPE_DRAFT: RoomTypeDraft = {
  propertyId: '',
  code: '',
  capacityAdults: '2',
  capacityChildren: '0',
  basePrice: '',
  minPrice: '',
  maxPrice: '',
  bedCount: '1',
  allowShared: false,
};

function toCount(value: string, minimum: number): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : null;
}

interface RoomTypeNumbers {
  basePrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  adults: number | null;
  children: number | null;
  beds: number | null;
}

function parseNumbers(draft: RoomTypeDraft): RoomTypeNumbers {
  return {
    basePrice: toMoney(draft.basePrice),
    minPrice: toMoney(draft.minPrice),
    maxPrice: toMoney(draft.maxPrice),
    adults: toCount(draft.capacityAdults, 1),
    children: toCount(draft.capacityChildren, 0),
    beds: toCount(draft.bedCount, 1),
  };
}

function invalidFields(draft: RoomTypeDraft, numbers: RoomTypeNumbers): readonly string[] {
  const invalid: string[] = [];
  if (draft.propertyId === '') invalid.push('propertyId');
  if (draft.code.trim() === '') invalid.push('code');
  if (numbers.adults === null) invalid.push('capacityAdults');
  if (numbers.children === null) invalid.push('capacityChildren');
  if (numbers.basePrice === null) invalid.push('basePrice');
  if (numbers.minPrice === null) invalid.push('minPrice');
  if (numbers.maxPrice === null) invalid.push('maxPrice');
  if (numbers.beds === null) invalid.push('bedCount');
  return invalid;
}

function toInput(draft: RoomTypeDraft, numbers: RoomTypeNumbers): RoomTypeCreateRequest | null {
  const { basePrice, minPrice, maxPrice } = numbers;
  if (basePrice === null || minPrice === null || maxPrice === null) return null;
  return {
    propertyId: draft.propertyId,
    code: draft.code.trim(),
    capacityAdults: numbers.adults ?? 1,
    capacityChildren: numbers.children ?? 0,
    basePrice,
    minPrice,
    maxPrice,
    bedCount: numbers.beds ?? 1,
    allowShared: draft.allowShared,
  };
}

/**
 * Dựng thân request từ bản nhập. Trả danh sách trường sai để màn hình báo theo trường trước khi gọi API.
 */
export function toRoomTypeRequest(
  draft: RoomTypeDraft,
): { input: RoomTypeCreateRequest } | { invalid: readonly string[] } {
  const numbers = parseNumbers(draft);
  const invalid = invalidFields(draft, numbers);
  if (invalid.length > 0) return { invalid };
  const input = toInput(draft, numbers);
  return input === null ? { invalid: ['basePrice', 'minPrice', 'maxPrice'] } : { input };
}
