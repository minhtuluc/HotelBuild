/**
 * HB-205 AC7 — đổi ngày booking N phòng dùng cùng luật giá: giá kỳ mới là tổng N đơn vị nên chênh lệch
 * và `newTotal = max(oldTotal, giá kỳ mới)` (BR-BOOK-12) tính trên tổng N phòng.
 */
import { expect, test } from 'vitest';
import { bookingSummarySchema } from '@pinehill/contracts';
import {
  createBooking,
  issueQuote,
  login,
  rescheduleRequest,
  shifted,
  snapshotsOf,
  versionOf,
} from '../doi-ngay/fixture.js';

test('AC7: booking 2 phòng đổi ngày ⇒ giá kỳ mới = 2 × một phòng, snapshot RESCHEDULE đủ tổng', async () => {
  const token = await login();
  const { booking } = await createBooking({ roomCount: 2 }, { token });
  const singleOld = await issueQuote({ roomCount: 1 }, token);
  expect(booking.totalAmount).toBe(singleOld.total * 2);

  const singleNew = await issueQuote(
    { checkIn: shifted.checkIn, checkOut: shifted.checkOut, roomCount: 1 },
    token,
  );
  const version = await versionOf(token, booking.id);
  const response = await rescheduleRequest(
    token,
    booking.id,
    { checkIn: shifted.checkIn, checkOut: shifted.checkOut },
    { tag: version },
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const offered = singleNew.total * 2;
  expect(bookingSummarySchema.parse(response.body).totalAmount).toBe(
    Math.max(offered, booking.totalAmount),
  );
  const appended = (await snapshotsOf(booking.id))[1]!;
  expect(appended.payload_json.totals.grossAmount).toBe(offered);
});
