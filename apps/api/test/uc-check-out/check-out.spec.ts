/**
 * HB-145 — ca riêng của endpoint trả phòng: PIN, phát sinh, trả sớm, việc dọn đúng một lần, replay.
 * Bộ test khoá HB-143 (`test/front-office/front-office.locked.spec.ts`) phủ các bậc phụ thu/nợ;
 * tệp này không lặp lại mà đào sâu các nhánh hợp đồng của HB-145.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { checkOutResponseSchema } from '@pinehill/contracts';
import {
  D,
  NIGHTLY,
  bookingRow,
  charges,
  checkOutBody,
  checkedIn,
  clock,
  day,
  errorCode,
  history,
  mintPin,
  outbox,
  post,
  postWith,
  q1,
  refunds,
  roomTasks,
  rows,
  seedBooking,
  staffToken,
  unreleased,
  checkoutAuditCount,
  userId,
  vn,
} from './fixture.js';

test('thiếu hoặc sai pinToken → 401 E_AUTH_PIN_REQUIRED, không giải phóng phòng', async () => {
  const seed = await checkedIn(q1);
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  for (const body of [checkOutBody(seed), checkOutBody(seed, 'f'.repeat(32))]) {
    const response = await post(token, body);
    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe('E_AUTH_PIN_REQUIRED');
  }
  expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_IN', balance_due: '0' });
  expect(await unreleased(seed.bookingRoomId)).toHaveLength(1);
  expect(await roomTasks(q1, D)).toEqual([]);
});

test('pinToken đã tiêu thụ không dùng lại được, kể cả khi lệnh bị từ chối vì số dư', async () => {
  // 15:00 ⇒ phụ thu 50% = 550.000; lệnh ghi nghĩa vụ rồi từ chối nên PIN đã bị tiêu thụ.
  clock.value = vn(D, '15:00:00');
  const seed = await checkedIn(q1);
  const token = await staffToken('FRONT_DESK');
  const pin = await mintPin(token, seed.id);
  const first = await post(token, checkOutBody(seed, pin));
  expect([409, 422]).toContain(first.status);
  const second = await post(token, checkOutBody(seed, pin));
  expect(second.status).toBe(401);
  expect(errorCode(second)).toBe('E_AUTH_PIN_REQUIRED');
});

test('phát sinh chưa thu là nghĩa vụ thật → từ chối, không giải phóng, không sinh việc dọn', async () => {
  const seed = await checkedIn(q1);
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const response = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    extras: [{ description: 'Nước suối', amount: 20_000, quantity: 2 }],
  });
  expect([409, 422]).toContain(response.status);
  expect(await charges(seed.id, 'EXTRA_SERVICE')).toEqual([
    expect.objectContaining({ amount: '40000', reason: 'Nước suối', voided_amount: '0' }),
  ]);
  expect(await bookingRow(seed.id)).toMatchObject({
    status: 'CHECKED_IN',
    balance_due: '40000',
  });
  expect(await unreleased(seed.bookingRoomId)).toHaveLength(1);
  expect(await roomTasks(q1, D)).toEqual([]);
  expect(await checkoutAuditCount(seed.id)).toBe(0);
});

test('thu đủ phát sinh rồi thử lại → CHECKED_OUT, giải phóng, đúng một việc dọn', async () => {
  const seed = await checkedIn(q1);
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const extras = [{ description: 'Nước suối', amount: 20_000, quantity: 2 }];
  const first = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    extras,
  });
  expect([409, 422]).toContain(first.status);
  const extra = (await charges(seed.id, 'EXTRA_SERVICE'))[0]!;
  await rows(
    `WITH p AS (INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
       VALUES($1,'EXTRA_SERVICE','CASH',$2,'SUCCEEDED',$3,clock_timestamp(),$4) RETURNING id)
     INSERT INTO payment_allocations(payment_id,charge_id,amount) SELECT id,$5,$2 FROM p`,
    [seed.id, 40_000, randomUUID(), userId, extra.id],
  );
  await rows('UPDATE bookings SET paid_amount=paid_amount+$2,balance_due=0 WHERE id=$1', [
    seed.id,
    40_000,
  ]);
  const second = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    extras,
  });
  expect(second.status).toBe(200);
  expect(checkOutResponseSchema.parse(second.body)).toMatchObject({
    status: 'CHECKED_OUT',
    extrasAmount: 40_000,
    feeAmount: 0,
    balanceDue: 0,
  });
  expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_OUT', balance_due: '0' });
  expect(await unreleased(seed.bookingRoomId)).toEqual([]);
  expect(await roomTasks(q1, D)).toHaveLength(1);
  expect((await roomTasks(q1, D))[0]!.status).toBe('PENDING');
});

test('trả phòng sớm → CHECKED_OUT (không CANCELLED) + RefundRequest EARLY_CHECKOUT', async () => {
  // 3 đêm 08–10/11, clock 10/11: đêm 10/11 chưa ở; HB053 áp bậc bắt tất 50% trên trần
  // min(paid, giá đêm chưa ở) = 1.100.000 ⇒ hoàn 550.000.
  const seed = await checkedIn(q1, 3 * NIGHTLY, day(D, -2), day(D, 1));
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const response = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    earlyCheckOut: true,
  });
  expect(response.status).toBe(200);
  expect(checkOutResponseSchema.parse(response.body)).toMatchObject({
    status: 'CHECKED_OUT',
    feeAmount: 0,
    balanceDue: 0,
  });
  expect(await bookingRow(seed.id)).toMatchObject({
    status: 'CHECKED_OUT',
    total_amount: String(2 * NIGHTLY),
    balance_due: '0',
  });
  expect(await refunds(seed.id)).toEqual([
    expect.objectContaining({
      status: 'PENDING',
      reason: 'EARLY_CHECKOUT',
      requested_amount: String(NIGHTLY / 2),
      refund_percent: '50.00',
    }),
  ]);
  // Đêm chưa ở bị void; hai đêm đã ở giữ nghĩa vụ.
  expect((await charges(seed.id, 'ROOM')).map((row) => row.voided_amount)).toEqual([
    '0',
    '0',
    String(NIGHTLY),
  ]);
  expect(await roomTasks(q1, D)).toHaveLength(1);
  expect(await unreleased(seed.bookingRoomId)).toEqual([]);
});

test('cờ earlyCheckOut phải khớp ngày trả phòng thực tế', async () => {
  const seed = await checkedIn(q1);
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const response = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    earlyCheckOut: true,
  });
  expect(response.status).toBe(409);
  expect(errorCode(response)).toBe('E_BOOK_INVALID_STATE');
  expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_IN' });
});

test('replay cùng Idempotency-Key trả lại kết quả, không sinh thêm việc dọn/lịch sử/outbox', async () => {
  const seed = await checkedIn(q1);
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const body = checkOutBody(seed, await mintPin(token, seed.id));
  const key = randomUUID();
  const first = await postWith(token, body, key);
  expect(first.status).toBe(200);
  const second = await postWith(token, body, key);
  expect(second.status).toBe(200);
  expect(second.headers['idempotency-replayed']).toBe('true');
  expect(second.body).toEqual(first.body);
  expect(await roomTasks(q1, D)).toHaveLength(1);
  expect(await history(seed.id, 'CHECKED_OUT')).toHaveLength(1);
  expect(await outbox(seed.id)).toHaveLength(1);
  expect(await checkoutAuditCount(seed.id)).toBe(1);
});

test('chỉ booking CHECKED_IN mới trả phòng được', async () => {
  const seed = await seedBooking({ status: 'CONFIRMED', assign: q1 });
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const response = await post(token, checkOutBody(seed, await mintPin(token, seed.id)));
  expect(response.status).toBe(409);
  expect(errorCode(response)).toBe('E_BOOK_INVALID_STATE');
  expect(await unreleased(seed.bookingRoomId)).toHaveLength(1);
});
