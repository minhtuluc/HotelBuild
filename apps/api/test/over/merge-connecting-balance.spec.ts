/**
 * HB-237 (TD-18) — `bookings.balance_due` phải khớp sổ cái sau ghép `MERGE_CONNECTING`.
 *
 * Trước đây `reduceObligation` tự ghi `balance_due = max(0, Σ ROOM − paid_amount)`: chỉ cộng nghĩa vụ ROOM
 * và bỏ qua tiền đã hoàn. `GET /bookings/{id}` trả thẳng cột này, nên khách và lễ tân thấy "không còn nợ"
 * trong khi phụ thu `EXTRA_SERVICE` vẫn chưa thu.
 */
import { expect, test } from 'vitest';
import { z } from 'zod';
import { etagOf, get, mintPin, post, rows, staffToken } from './helpers/harness.js';
import { roomTypes, rooms, seedBooking } from './helpers/seed.js';
import { mergeViewSchema } from './helpers/views.js';

const MERGES = '/api/v1/room-merges';
const EXTRA = 200_000;

test('HB237_connecting_merge_keeps_balance_due_equal_to_ledger', async () => {
  const prices = [1_530_000, 1_836_000];
  // Hai đêm × hai BookingRoom (cùng số với test khoá HB-124: gộp ORIGINAL 6.732.000).
  const roomTotal = (prices[0]! + prices[1]!) * 2;
  const booking = await seedBooking({
    nightlyPrices: prices,
    spaces: 2,
    roomType: roomTypes.connecting,
    assignRoomIds: [rooms.c1, rooms.c2],
    paid: [{ amount: roomTotal, method: 'CASH' }],
  });
  // Phụ thu dịch vụ chưa thu (không gắn đêm/phòng).
  await rows(
    "INSERT INTO booking_charges(booking_id,kind,source_key,amount) VALUES($1,'EXTRA_SERVICE','hb237:extra',$2)",
    [booking.id, EXTRA],
  );
  const token = await staffToken('desk');
  const created = await post(MERGES, token, {
    bookingId: booking.id,
    roomIdA: rooms.c1,
    roomIdB: rooms.c2,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const merge = mergeViewSchema.parse(created.body);
  const tag = etagOf(await get(`${MERGES}/${merge.id}`, token));
  const done = await post(
    `${MERGES}/${merge.id}/execute`,
    token,
    { pinToken: await mintPin('desk', booking.id) },
    { tag },
  );
  expect([200, 201]).toContain(done.status);

  // ROOM đã trả đủ (phần thừa sau chiết khấu được nhả, không tự trừ vào phụ thu) ⇒ còn nợ đúng phụ thu.
  const [row] = await rows('SELECT balance_due::text AS due FROM bookings WHERE id=$1', [
    booking.id,
  ]);
  expect(row?.due).toBe(String(EXTRA));
  const read = await get(`/api/v1/bookings/${booking.id}`, token);
  expect(read.status).toBe(200);
  expect(z.object({ balanceDue: z.number() }).parse(read.body).balanceDue).toBe(EXTRA);
});
