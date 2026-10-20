/**
 * HB-151 — idempotency từng bước của walk-in.
 *
 * Bước 1 (`POST /walk-in`): một `Idempotency-Key` cho cả quote → booking; phát lại y nguyên, khoá khác
 * cùng thân lệnh rơi vào BR-BOOK-16 (không tạo bản thứ hai), khoá cũ khác thân lệnh bị từ chối.
 * Bước 2 (`POST /payments`, HB-096): phát lại cùng khoá không thu hai lần; khoá mới khi đã đủ cọc bị
 * từ chối vì không còn nghĩa vụ.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { errorBodySchema, paymentSchema } from '@pinehill/contracts';
import {
  count,
  depositBody,
  paymentRequest,
  pinTokenFor,
  staffToken,
  walkInBody,
  walkInRequest,
  walkInResponseSchema,
} from './fixture.js';

test('cùng khoá + cùng thân lệnh → phát lại y nguyên; đúng một booking/quote/snapshot/audit', async () => {
  const token = await staffToken();
  const key = randomUUID();
  const body = walkInBody();
  const first = await walkInRequest(body, { token, key });
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  const replay = await walkInRequest(body, { token, key });
  expect(replay.status).toBe(201);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(replay.body).toEqual(first.body);
  const { quote } = walkInResponseSchema.parse(first.body);
  expect(await count('SELECT id FROM bookings')).toBe(1);
  expect(await count('SELECT id FROM price_snapshots WHERE quote_id=$1', [quote.quoteId])).toBe(1);
  expect(await count("SELECT id FROM audit_logs WHERE action='BOOKING_CREATED'")).toBe(1);
});

test('cùng khoá nhưng thân lệnh khác → 409 E_SYS_IDEMPOTENCY_KEY_REUSED, không thêm booking', async () => {
  const token = await staffToken();
  const key = randomUUID();
  const body = walkInBody();
  expect((await walkInRequest(body, { token, key })).status).toBe(201);
  const changed = await walkInRequest({ ...body, note: 'Ghi chú khác' }, { token, key });
  expect(changed.status).toBe(409);
  expect(errorBodySchema.parse(changed.body).code).toBe('E_SYS_IDEMPOTENCY_KEY_REUSED');
  expect(await count('SELECT id FROM bookings')).toBe(1);
});

test('bấm hai lần đồng thời cùng khoá → tối đa một lệnh chạy, lần sau phát lại', async () => {
  const token = await staffToken();
  const key = randomUUID();
  const body = walkInBody();
  const [first, second] = await Promise.all([
    walkInRequest(body, { token, key }),
    walkInRequest(body, { token, key }),
  ]);
  for (const result of [first, second]) expect([201, 409]).toContain(result.status);
  expect([first.status, second.status]).toContain(201);
  const busy = [first, second].find((result) => result.status === 409);
  if (busy) expect(errorBodySchema.parse(busy.body).code).toBe('E_SYS_REQUEST_IN_PROGRESS');
  const retry = await walkInRequest(body, { token, key });
  expect(retry.status).toBe(201);
  expect(retry.headers['idempotency-replayed']).toBe('true');
  expect(await count('SELECT id FROM bookings')).toBe(1);
});

test('khoá khác nhưng cùng thân lệnh → BR-BOOK-16 trả booking cũ (200, cờ nghi trùng)', async () => {
  const token = await staffToken();
  const body = walkInBody();
  const first = await walkInRequest(body, { token });
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  const original = walkInResponseSchema.parse(first.body);

  const repeat = await walkInRequest(body, { token });
  expect(repeat.status, JSON.stringify(repeat.body)).toBe(200);
  const duplicate = walkInResponseSchema.parse(repeat.body);
  expect(duplicate.created).toBe(false);
  expect(duplicate.booking.id).toBe(original.booking.id);
  expect(duplicate.booking.duplicateSuspected).toBe(true);
  expect(await count('SELECT id FROM bookings')).toBe(1);
  expect(await count('SELECT id FROM price_snapshots')).toBe(1);
  expect(await count('SELECT id FROM payments')).toBe(0);
});

test('bước thu cọc: phát lại cùng khoá không thu hai lần; khoá mới khi đã đủ cọc bị từ chối', async () => {
  const token = await staffToken();
  const created = await walkInRequest(walkInBody(), { token });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const { quote, booking } = walkInResponseSchema.parse(created.body);

  const pinToken = await pinTokenFor(token, booking.id);
  const body = depositBody(booking.id, quote.depositAmount, pinToken);
  const key = randomUUID();
  const first = await paymentRequest(body, token, key);
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  expect(paymentSchema.parse(first.body)).toMatchObject({
    bookingId: booking.id,
    amount: quote.depositAmount,
    status: 'SUCCEEDED',
  });

  const replay = await paymentRequest(body, token, key);
  expect(replay.status).toBe(201);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(replay.body).toEqual(first.body);
  expect(await count('SELECT id FROM payments WHERE booking_id=$1', [booking.id])).toBe(1);

  const freshToken = await pinTokenFor(token, booking.id);
  const again = await paymentRequest(
    depositBody(booking.id, quote.depositAmount, freshToken),
    token,
  );
  expect(again.status).toBe(409);
  expect(errorBodySchema.parse(again.body).code).toBe('E_BOOK_INVALID_STATE');
  expect(await count('SELECT id FROM payments WHERE booking_id=$1', [booking.id])).toBe(1);
});
