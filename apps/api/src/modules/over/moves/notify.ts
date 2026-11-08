/**
 * BR-OVER-10 (HB-223): mọi `RoomMove` thực thi PHẢI báo khách trong 15 phút. Ghi `notifications`
 * `PENDING` trong **cùng transaction** với execute (rollback thì không còn thông báo) rồi phát job gửi
 * (worker dựng nội dung theo mẫu `room-moved`), đúng mẫu dùng của `NotificationGateway` (noti/README).
 * Nội dung chỉ gồm khoá của `notificationMessageSchema`; không chép lý do nội bộ của nhân viên.
 */
import type { NotificationGateway } from '../../noti/gateway.js';
import type { Tx } from '../support.js';
import { businessDate } from '../support.js';

export const ROOM_MOVED_TEMPLATE = 'room-moved';

interface GuestContact {
  readonly code: string;
  readonly check_in: Date;
  readonly check_out: Date;
  readonly full_name: string;
  readonly email: string | null;
  readonly phone: string;
}

const WALK_OUT_TEXT =
  'Khách sạn rất tiếc không thể bố trí phòng cho kỳ lưu trú này; nhân viên sẽ liên hệ về nơi ở thay thế, hoàn tiền và bồi thường.';
const MOVED_TEXT = 'Phòng của quý khách đã được đổi; giá đã chốt cho kỳ lưu trú được giữ nguyên.';

export async function notifyGuestOfMove(
  tx: Tx,
  gateway: NotificationGateway,
  move: { readonly booking_id: string; readonly move_type: string },
): Promise<void> {
  const [contact] = await tx.$queryRaw<GuestContact[]>`
    SELECT b.code, b.check_in, b.check_out, g.full_name, g.email, g.phone
      FROM bookings b JOIN guests g ON g.id = b.guest_id
     WHERE b.id = ${move.booking_id}::uuid`;
  if (contact === undefined) return;
  const id = await gateway.record(tx, {
    bookingId: move.booking_id,
    recipient: contact.email ?? contact.phone,
    channel: contact.email === null ? 'SMS' : 'EMAIL',
    template: ROOM_MOVED_TEMPLATE,
    message: {
      guestName: contact.full_name,
      bookingCode: contact.code,
      checkIn: businessDate(contact.check_in),
      checkOut: businessDate(contact.check_out),
      reason: move.move_type === 'WALK_OUT' ? WALK_OUT_TEXT : MOVED_TEXT,
    },
  });
  await gateway.publish(id);
}
