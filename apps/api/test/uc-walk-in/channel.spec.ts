/**
 * HB-151 — kênh walk-in do **cấu hình** quyết định (api.md §2.5, BR-BOOK-07, BR-RATE-07/09).
 *
 * Không hard-code id kênh: mỗi ca sửa hàng `channels` rồi kiểm hành vi của lệnh — hold, trạng thái kênh,
 * việc thiếu cấu hình và hệ số giá đều phải đi theo dữ liệu, không theo hằng số trong mã.
 */
import { expect, test } from 'vitest';
import { z } from 'zod';
import { errorBodySchema } from '@pinehill/contracts';
import {
  channelConfig,
  count,
  rows,
  staffToken,
  walkInBody,
  walkInRequest,
  walkInResponseSchema,
} from './fixture.js';

const holdSecondsSchema = z.object({ seconds_left: z.number() });

async function holdSeconds(id: string): Promise<number> {
  const [row] = z.array(holdSecondsSchema).parse(
    await rows(
      `SELECT extract(epoch FROM (hold_expires_at - clock_timestamp()))::float8 AS seconds_left
         FROM bookings WHERE id=$1`,
      [id],
    ),
  );
  return row!.seconds_left;
}

test('hold_minutes của kênh WALKIN quyết định HELD: đặt 30 phút → booking HELD đúng 30 phút', async () => {
  await rows("UPDATE channels SET hold_minutes=30 WHERE code='WALKIN'");
  const token = await staffToken();
  const response = await walkInRequest(walkInBody(), { token });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const { booking } = walkInResponseSchema.parse(response.body);
  expect(booking.status).toBe('HELD');
  expect(booking.holdExpiresAt).not.toBeNull();
  const seconds = await holdSeconds(booking.id);
  expect(seconds).toBeGreaterThan(1740);
  expect(seconds).toBeLessThanOrEqual(1800);
  expect(await count('SELECT id FROM payments WHERE booking_id=$1', [booking.id])).toBe(0);
});

test('kênh WALKIN INACTIVE → 409 E_BOOK_INVALID_STATE, không tạo booking', async () => {
  await rows("UPDATE channels SET status='INACTIVE' WHERE code='WALKIN'");
  const token = await staffToken();
  const response = await walkInRequest(walkInBody(), { token });
  expect(response.status).toBe(409);
  expect(errorBodySchema.parse(response.body).code).toBe('E_BOOK_INVALID_STATE');
  expect(await count('SELECT id FROM bookings')).toBe(0);
});

test('thiếu hàng cấu hình kênh WALKIN → 404, không tạo booking', async () => {
  const token = await staffToken();
  try {
    await rows("DELETE FROM channels WHERE code='WALKIN'");
    const response = await walkInRequest(walkInBody(), { token });
    expect(response.status).toBe(404);
    expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_NOT_FOUND');
    expect(await count('SELECT id FROM bookings')).toBe(0);
  } finally {
    await rows(
      "INSERT INTO channels(code,name,multiplier) VALUES('WALKIN','Khách vãng lai tại quầy',1.1) ON CONFLICT (code) DO NOTHING",
    );
  }
});

test('hệ số giá walk-in đọc từ cấu hình kênh, không hard-code 1,10', async () => {
  await rows("UPDATE channels SET multiplier=1.500 WHERE code='WALKIN'");
  const token = await staffToken();
  const response = await walkInRequest(walkInBody(), { token });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const { quote } = walkInResponseSchema.parse(response.body);
  expect(quote.channelCode).toBe('WALKIN');
  for (const night of quote.nights) expect(night.channelMultiplier).toBeCloseTo(1.5, 5);
  expect((await channelConfig()).hold_minutes).toBe(0);
});
