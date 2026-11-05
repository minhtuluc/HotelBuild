/** Kiểm hình học phòng đích so với hạng đang đặt (HB-125 AC4): cơ sở, hạng, sức chứa. */
import { AppError } from '../../../common/app-error.js';
import { businessConflict } from '../support.js';
import type { RoomTypeRow } from './queries.js';
import type { RoomTarget } from './writes.js';

export function checkGeometry(
  moveType: string,
  bookingType: RoomTypeRow,
  target: RoomTarget,
  bookingPropertyId: string,
  adults: number,
): void {
  const cross = moveType.endsWith('CROSS_PROPERTY');
  const sameProperty = target.property_id === bookingPropertyId;
  if (cross && sameProperty)
    throw businessConflict(
      'E_OVER_MOVE_NOT_ALLOWED',
      'Điều chuyển khác cơ sở cần cơ sở đích khác.',
    );
  if (!cross && !sameProperty)
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Điều chuyển cùng cơ sở không đổi cơ sở.');
  if (moveType.startsWith('SAME_TYPE') && target.code !== bookingType.code)
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Điều chuyển cùng loại cần đúng hạng phòng.');
  if (moveType.startsWith('UPGRADE') && target.base_price < bookingType.base_price)
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Điều chuyển nâng hạng cần hạng cao hơn.');
  if (target.capacity_adults < adults)
    throw new AppError(422, 'E_BOOK_OVER_CAPACITY', 'Sức chứa phòng đích không đủ cho số khách.');
}
