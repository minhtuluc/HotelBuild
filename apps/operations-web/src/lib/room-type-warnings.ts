/**
 * Kiểm tra hiển thị cho sàn–trần giá (BR-RATE-03, BR-RATE-04). Đây là **cảnh báo ở giao diện**:
 * nguồn chân lý vẫn là server, màn hình không tự chặn theo các điều kiện này.
 */
export interface RoomTypePriceInput {
  basePrice: number;
  minPrice: number;
  maxPrice: number;
}

export type RoomTypePriceWarning = 'floorAboveCeiling' | 'baseBelowFloor' | 'baseAboveCeiling';

export function roomTypePriceWarnings(input: RoomTypePriceInput): readonly RoomTypePriceWarning[] {
  const warnings: RoomTypePriceWarning[] = [];
  if (input.minPrice > input.maxPrice) warnings.push('floorAboveCeiling');
  if (input.basePrice < input.minPrice) warnings.push('baseBelowFloor');
  if (input.basePrice > input.maxPrice) warnings.push('baseAboveCeiling');
  return warnings;
}
