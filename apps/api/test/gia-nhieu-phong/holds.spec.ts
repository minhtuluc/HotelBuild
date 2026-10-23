/**
 * HB-205 AC6 — giữ chỗ N phòng ghi tổng N đơn vị và đơn giá phòng-đêm của MỘT đơn vị bán.
 */
import { expect, test } from 'vitest';
import { z } from 'zod';
import { holdBody, createHold, issueQuote, rows } from '../holds/fixture.js';

test('AC6: hold 2 phòng ⇒ bookings.total_amount = quote.total (2 đơn vị) và price_per_night = một phòng-đêm', async () => {
  const single = await issueQuote({ roomCount: 1 });
  const hold = await createHold(holdBody({ roomCount: 2 }));

  const [booking] = z
    .array(z.object({ total_amount: z.string(), room_count: z.number() }))
    .parse(
      await rows('SELECT total_amount::text, room_count FROM bookings WHERE id=$1', [
        hold.bookingId,
      ]),
    );
  expect(booking?.room_count).toBe(2);
  expect(Number(booking?.total_amount)).toBe(single.total * 2);

  const perRoom = z
    .array(z.object({ price_per_night: z.string() }))
    .parse(
      await rows('SELECT price_per_night::text FROM booking_rooms WHERE booking_id=$1', [
        hold.bookingId,
      ]),
    );
  expect(perRoom).toHaveLength(2);
  const nights = single.nights.length;
  for (const room of perRoom)
    expect(Number(room.price_per_night)).toBe(Math.floor(single.total / nights));
});
