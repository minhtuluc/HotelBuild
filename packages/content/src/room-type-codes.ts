/**
 * Mã hạng phòng có trang `/room-types/[code]` (HB-310, HB-311). Tách khỏi `room-type-pages.ts` để màn chạy ở
 * trình duyệt (SCR-02) kiểm được mã mà không kéo câu chữ sáu ngôn ngữ vào bundle (HB-317).
 */
export type RoomTypeCode = 'STD' | 'SUP' | 'DLX' | 'FAM' | 'DOR';

export const ROOM_TYPE_CODES: readonly RoomTypeCode[] = ['STD', 'SUP', 'DLX', 'FAM', 'DOR'];

export function isRoomTypeCode(value: string): value is RoomTypeCode {
  return ROOM_TYPE_CODES.some((code) => code === value);
}
