/**
 * Khoá tài nguyên theo **đúng thứ tự ADR-014** (`operation idempotency → bookings → properties →
 * room_types → rooms`), dùng hàng có sẵn làm khoá thô cho quy mô 55 phòng — không thêm bảng room-day.
 *
 * Vì sao khoá ở đây mới kiểm tồn: `SELECT FOR UPDATE` trên tập assignment rỗng không khoá được một
 * ngày chưa bán, nên khoá `properties` (tuần tự hoá quyết định bán vượt) **và** `room_types` (bảo vệ
 * kiểm tồn cả kỳ) là điều kiện để `loadInventoryFacts` sau đó đọc ra sự thật đã ổn định. Hàng
 * `operation idempotency` do `IdempotencyStore` (HB-029) khoá trước khi use case chạy.
 *
 * Lệnh gọi chạy trong transaction `READ COMMITTED` + `lock_timeout = DEFAULT` do store đặt lại
 * (`common/idempotency/store.ts`); deadlock/serialization conflict (40P01/40001/55P03) được
 * `inventoryError` đổi thành `RetryTransaction` và store chạy lại **toàn bộ** transaction ≤ 3 lần.
 */
import type { Prisma as PrismaTypes } from '@prisma/client';
import { missing } from './validation.js';

type Tx = PrismaTypes.TransactionClient;

export interface StockLock {
  readonly propertyId: string;
  readonly roomTypeId: string;
  /** BR-BOOK-04: sức chứa tối đa = `capacityAdults × roomCount`. */
  readonly capacityAdults: number;
}

/**
 * Khoá `properties` → `room_types` → mọi `rooms` của loại phòng (`ORDER BY id`). Trả hàng `room_types`
 * **đã khoá** để kiểm sức chứa (BR-BOOK-04) và dùng lại loại phòng cho bước gán.
 */
export async function lockStock(
  tx: Tx,
  propertyId: string,
  roomTypeId: string,
): Promise<StockLock> {
  const property = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM properties WHERE id=${propertyId}::uuid FOR UPDATE`;
  const type = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM room_types WHERE id=${roomTypeId}::uuid FOR UPDATE`;
  if (property.length === 0 || type.length === 0) throw missing();
  const row = await tx.room_types.findUnique({
    where: { id: roomTypeId },
    select: { property_id: true, capacity_adults: true },
  });
  // Loại phòng không thuộc cơ sở đang hỏi: không có gì để giữ (như `GET /inventory/availability`).
  if (row === null || row.property_id !== propertyId) throw missing();
  await tx.$queryRaw`SELECT id FROM rooms WHERE room_type_id=${roomTypeId}::uuid ORDER BY id FOR UPDATE`;
  return { propertyId, roomTypeId, capacityAdults: row.capacity_adults };
}

export interface HeldHold {
  readonly id: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
}

/**
 * Khoá để **giải phóng** hold: `bookings` (chính booking giữ chỗ) → `properties` → `room_types` →
 * các `rooms` đang được gán, đúng thứ tự ADR-014. Booking chưa tồn tại ⇒ `404 E_GEN_NOT_FOUND`
 * (api.md §1.4: ID con phải tra từ aggregate đã kiểm quyền).
 */
export async function lockHeldHold(tx: Tx, holdId: string): Promise<HeldHold> {
  const rows = await tx.$queryRaw<
    { id: string; property_id: string; room_type_id: string }[]
  >`SELECT id, property_id, room_type_id FROM bookings WHERE id=${holdId}::uuid FOR UPDATE`;
  const booking = rows[0];
  if (booking === undefined) throw missing();
  await tx.$queryRaw`SELECT id FROM properties WHERE id=${booking.property_id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM room_types WHERE id=${booking.room_type_id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM rooms WHERE id IN (
      SELECT a.room_id FROM room_assignments a
      JOIN booking_rooms br ON br.id = a.booking_room_id
      WHERE br.booking_id = ${booking.id}::uuid
    ) ORDER BY id FOR UPDATE`;
  return { id: booking.id, propertyId: booking.property_id, roomTypeId: booking.room_type_id };
}

/**
 * Lỗi CSDL/đua tranh của đường tồn phòng: dùng lại đúng ánh xạ đang chạy của module khoá phòng
 * (HB-034, `prop/room-blocks/locks.ts`) — `23P01` (ràng buộc loại trừ HB-008) ⇒ `409 E_INV_ROOM_TAKEN`,
 * `40P01/40001/55P03` ⇒ tín hiệu chạy lại **toàn bộ** transaction, không tự chế mã.
 */
export { inventoryError } from '../../prop/room-blocks/locks.js';
