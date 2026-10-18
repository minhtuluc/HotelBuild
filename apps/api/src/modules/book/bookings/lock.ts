/**
 * Khoá tài nguyên cho đường đặt phòng, theo **đúng thứ tự ADR-014**
 * (`operation idempotency → bookings → properties → room_types → rooms`).
 *
 * Tạo booking dùng lại nguyên `lockStock` của HB-076 (`book/holds/lock.ts`): `properties` tuần tự hoá
 * quyết định bán, `room_types` và mọi `rooms` của loại phòng bảo vệ bước kiểm tồn + gán đơn vị bán, và
 * `inventoryError` đổi `23P01` (ràng buộc loại trừ HB-008) thành `409 E_INV_ROOM_TAKEN` còn
 * `40P01/40001/55P03` thành tín hiệu chạy lại **toàn bộ** transaction của `IdempotencyStore` (HB-029).
 * Không chép lại thứ tự khoá: một chỗ duy nhất cho ADR-014.
 *
 * Xác nhận booking chỉ khoá `bookings → properties → room_types`: BR-BOOK-09 giữ nguyên assignment nên
 * đường này **không** ghi `booking_rooms`/`room_assignments`.
 */
import type { Prisma as PrismaTypes } from '@prisma/client';
import { missing } from './validation.js';

export { inventoryError, lockStock } from '../holds/lock.js';
export type { StockLock } from '../holds/lock.js';

type Tx = PrismaTypes.TransactionClient;

export interface LockedBooking {
  readonly id: string;
  readonly guestId: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly status: string;
  readonly version: bigint;
  readonly holdExpiresAt: Date | null;
  readonly checkIn: Date;
  readonly checkOut: Date;
  readonly depositAmount: bigint;
  readonly totalAmount: bigint;
  readonly duplicateSuspected: boolean;
}

/**
 * Khoá `bookings` (chính booking) → `properties` → `room_types`, rồi trả hàng `bookings` **đã khoá** để
 * use case đọc trạng thái/hạn bằng giờ CSDL (BR-BOOK-18). Booking chưa tồn tại ⇒ `404 E_GEN_NOT_FOUND`
 * (api.md §1.4: ID con phải tra từ aggregate đã kiểm quyền).
 */
export async function lockBooking(tx: Tx, bookingId: string): Promise<LockedBooking> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      guest_id: string;
      property_id: string;
      room_type_id: string;
      status: string;
      version: bigint;
      hold_expires_at: Date | null;
      check_in: Date;
      check_out: Date;
      deposit_amount: bigint;
      total_amount: bigint;
      duplicate_suspected: boolean;
    }[]
  >`SELECT id, guest_id, property_id, room_type_id, status, version, hold_expires_at, check_in,
           check_out, deposit_amount, total_amount, duplicate_suspected
      FROM bookings WHERE id=${bookingId}::uuid FOR UPDATE`;
  const booking = rows[0];
  if (booking === undefined) throw missing();
  await tx.$queryRaw`SELECT id FROM properties WHERE id=${booking.property_id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM room_types WHERE id=${booking.room_type_id}::uuid FOR UPDATE`;
  return {
    id: booking.id,
    guestId: booking.guest_id,
    propertyId: booking.property_id,
    roomTypeId: booking.room_type_id,
    status: booking.status,
    version: booking.version,
    holdExpiresAt: booking.hold_expires_at,
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    depositAmount: booking.deposit_amount,
    totalAmount: booking.total_amount,
    duplicateSuspected: booking.duplicate_suspected,
  };
}
