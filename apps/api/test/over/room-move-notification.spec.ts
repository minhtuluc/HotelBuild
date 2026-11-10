/**
 * HB-223 — BR-OVER-10: mọi `RoomMove` thực thi PHẢI gửi thông báo cho khách trong 15 phút. QA HB-194
 * (QA-F6-10): execute chỉ ghi outbox `InventoryChanged`, bảng `notifications` trống. Thông báo được ghi
 * `PENDING` **cùng transaction** với execute (lệnh thất bại không để lại thông báo) và phát job gửi
 * (worker có sẵn mẫu `room-moved`).
 */
import { expect, test } from 'vitest';
import { etagOf, get, mintPin, rows, staffToken } from './helpers/harness.js';
import { MOVES, approveMove, executeMove, moveBody, proposeMove } from './helpers/actions.js';
import { rooms, seedBooking } from './helpers/seed.js';

const notificationsOf = (bookingId: string) =>
  rows(
    `SELECT template, channel, recipient, status, payload_json FROM notifications
      WHERE booking_id = $1 ORDER BY created_at`,
    [bookingId],
  );
const guestPhoneOf = async (bookingId: string) =>
  String(
    (
      await rows(
        'SELECT g.phone FROM bookings b JOIN guests g ON g.id = b.guest_id WHERE b.id = $1',
        [bookingId],
      )
    )[0]?.phone,
  );

test('HB223_executed_relocation_notifies_guest_once', async () => {
  const token = await staffToken('desk');
  const booking = await seedBooking({ assignRoomIds: [rooms.r1] });
  const move = await proposeMove(token, moveBody(booking.id, booking.bookingRoomIds[0]!, rooms.r2));
  expect(await notificationsOf(booking.id)).toHaveLength(0);

  const tag = etagOf(await get(`${MOVES}/${move.id}`, token));
  const executed = await executeMove(move.id, token, await mintPin('desk', booking.id), tag);
  expect(executed.status).toBe(200);

  const sent = await notificationsOf(booking.id);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    template: 'room-moved',
    channel: 'SMS',
    recipient: await guestPhoneOf(booking.id),
  });
  expect(['PENDING', 'SENT']).toContain(sent[0]?.status);
  // Nội dung chỉ gồm khoá của `notificationMessageSchema`; không mang lý do nội bộ của lễ tân.
  const payload = JSON.stringify(sent[0]?.payload_json);
  expect(payload).toContain('bookingCode');
  expect(payload).not.toContain('Quá tải loại STD');
});

test('HB223_failed_execute_leaves_no_notification', async () => {
  const token = await staffToken('desk');
  const booking = await seedBooking({ assignRoomIds: [rooms.r1] });
  const move = await proposeMove(token, moveBody(booking.id, booking.bookingRoomIds[0]!, rooms.r2));
  // Tem cũ ⇒ 412: transaction rollback, không có thông báo.
  const stale = await executeMove(move.id, token, await mintPin('desk', booking.id), '"0-0"');
  expect(stale.status).toBe(412);
  expect(await notificationsOf(booking.id)).toHaveLength(0);
});

test('HB223_executed_walkout_notifies_guest', async () => {
  const booking = await seedBooking({ nightlyPrices: [600_000], assignRoomIds: [rooms.r1] });
  const desk = await staffToken('desk');
  const move = await proposeMove(desk, {
    bookingId: booking.id,
    bookingRoomId: booking.bookingRoomIds[0],
    moveType: 'WALK_OUT',
    reason: 'Hết phòng phù hợp',
    compensationAmount: 600_000,
    transportCost: 0,
    walkOutDocNo: 'BB-223',
    guestSignatureRef: 'esign:guest:hb223',
    staffSignatureRef: 'esign:staff:hb223',
  });
  const approved = await approveMove(move.id, await staffToken('manager'), {
    compensationAmount: 600_000,
    transportCost: 0,
    pinToken: await mintPin('manager', booking.id),
  });
  expect([200, 201]).toContain(approved.status);
  const tag = etagOf(await get(`${MOVES}/${move.id}`, desk));
  const executed = await executeMove(move.id, desk, await mintPin('desk', booking.id), tag);
  expect(executed.status).toBe(200);
  const sent = await notificationsOf(booking.id);
  expect(sent.filter((row) => row.template === 'room-moved')).toHaveLength(1);
});
