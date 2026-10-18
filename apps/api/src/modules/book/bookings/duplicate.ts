/**
 * Phát hiện đặt trùng (BR-BOOK-16) — "cùng kênh + cùng số điện thoại + cùng loại phòng + cùng ngày nhận
 * phòng trong 24 giờ". Truy vấn chạy **sau khi đã khoá tồn** (`lock.ts`) nên hai lệnh song song cùng
 * khách/kỳ không thể cùng tạo mới: lệnh thứ hai nhìn thấy hàng của lệnh thứ nhất.
 *
 * `created_at > clock_timestamp() - interval '24 hours'` là **giờ CSDL** (BR-BOOK-18: mọi mốc so sánh
 * của đường booking dùng giờ máy chủ), không phải giờ tiến trình.
 *
 * Trạng thái kết thúc (`CANCELLED`, `EXPIRED`, `NO_SHOW`) không tính là trùng: khách huỷ rồi đặt lại
 * trong 24 giờ là ý định mới, không phải đặt lặp.
 */
import type { Prisma as PrismaTypes } from '@prisma/client';

type Tx = PrismaTypes.TransactionClient;

export interface DuplicateBooking {
  readonly id: string;
  readonly guestId: string;
  readonly propertyId: string;
}

export interface DuplicateQuery {
  readonly channelId: string;
  readonly roomTypeId: string;
  readonly checkIn: string;
  /** Khách sở hữu lệnh hiện tại (phiên khách) hoặc khách khớp SĐT (nhân viên). */
  readonly guestId: string;
  /** SĐT đã chuẩn hoá của liên hệ trên lệnh (`+84…`, BR-CRM-01). */
  readonly phone: string;
}

export async function findDuplicateBooking(
  tx: Tx,
  query: DuplicateQuery,
): Promise<DuplicateBooking | null> {
  const rows = await tx.$queryRaw<
    { id: string; guest_id: string; property_id: string }[]
  >`SELECT b.id, b.guest_id, b.property_id
      FROM bookings b
      JOIN guests g ON g.id = b.guest_id
     WHERE b.channel_id=${query.channelId}::uuid
       AND b.room_type_id=${query.roomTypeId}::uuid
       AND b.check_in=${query.checkIn}::date
       AND b.created_at > clock_timestamp() - interval '24 hours'
       AND b.status NOT IN ('CANCELLED','EXPIRED','NO_SHOW')
       AND (b.guest_id=${query.guestId}::uuid OR g.phone=${query.phone})
     ORDER BY b.created_at DESC
     LIMIT 1`;
  const row = rows[0];
  if (row === undefined) return null;
  return { id: row.id, guestId: row.guest_id, propertyId: row.property_id };
}
