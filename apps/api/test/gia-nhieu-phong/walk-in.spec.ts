/**
 * HB-205 AC6/AC8 — walk-in N phòng thu đủ N đơn vị (tái hiện F7-QA-03 của HB-196: DLX 2 phòng ra
 * 1.452.000 thay vì 2.904.000). Chứng minh trên đường thật `POST /walk-in`: tổng booking, giá phòng-đêm
 * của từng `booking_rooms` và snapshot ORIGINAL (đủ N phòng × đêm, Σ phân bổ = tổng).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { quoteSchema } from '@pinehill/contracts';
import {
  http,
  nextDay,
  propertyId,
  rows,
  staffToken,
  today,
  typeId,
  walkInBody,
  walkInRequest,
  walkInResponseSchema,
} from '../uc-walk-in/fixture.js';

async function walkInQuote(token: string, roomCount: number, checkIn: string, checkOut: string) {
  const response = await http()
    .post('/api/v1/quotes')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      propertyId,
      roomTypeId: typeId,
      channelCode: 'WALKIN',
      ratePlanCode: 'FLEX7',
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      roomCount,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return quoteSchema.parse(response.body);
}

test('AC6/AC8: walk-in 2 phòng 1 đêm = 2 × giá một phòng; booking_rooms và snapshot đủ 2 đơn vị', async () => {
  const token = await staffToken();
  const checkIn = today();
  const checkOut = nextDay(checkIn);
  const single = await walkInQuote(token, 1, checkIn, checkOut);

  const response = await walkInRequest(walkInBody({ roomCount: 2, checkIn, checkOut }), { token });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const { booking, quote } = walkInResponseSchema.parse(response.body);

  expect(quote.total).toBe(single.total * 2);
  expect(booking.totalAmount).toBe(single.total * 2);
  expect(booking.roomCount).toBe(2);

  const perRoom = z
    .array(z.object({ price_per_night: z.string() }))
    .parse(
      await rows('SELECT price_per_night::text FROM booking_rooms WHERE booking_id=$1', [
        booking.id,
      ]),
    );
  expect(perRoom).toHaveLength(2);
  // Mỗi đơn vị bán giữ đúng giá MỘT phòng-đêm (không còn nửa giá).
  for (const room of perRoom) expect(Number(room.price_per_night)).toBe(single.total);

  const [snapshot] = z
    .array(z.object({ gross_amount: z.string(), payload_json: z.unknown() }))
    .parse(
      await rows(
        "SELECT gross_amount::text, payload_json FROM price_snapshots WHERE booking_id=$1 AND kind='ORIGINAL'",
        [booking.id],
      ),
    );
  expect(snapshot).toBeDefined();
  const payload = z
    .object({ nights: z.array(z.object({ bookingRoomId: z.string(), grossAmount: z.number() })) })
    .parse(snapshot!.payload_json);
  expect(payload.nights).toHaveLength(2);
  expect(new Set(payload.nights.map((night) => night.bookingRoomId)).size).toBe(2);
  const sum = payload.nights.reduce((total, night) => total + night.grossAmount, 0);
  expect(sum).toBe(single.total * 2);
  expect(Number(snapshot!.gross_amount)).toBe(single.total * 2);
});
