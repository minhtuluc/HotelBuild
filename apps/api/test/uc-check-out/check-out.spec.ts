/**
 * HB-145 — ca riêng của endpoint trả phòng: PIN, phát sinh, trả sớm theo cấu hình snapshot,
 * việc dọn đúng một lần, replay sau khi mất phản hồi.
 * Bộ test khoá HB-143 (`test/front-office/front-office.locked.spec.ts`) phủ các bậc phụ thu/nợ.
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

/** Trả tiền một nghĩa vụ đã ghi (mô phỏng quầy thu tiền HB-096), cập nhật projection. */
async function settle(bookingId: string, chargeId: string, amount: number): Promise<void> {
  await rows(
    `WITH p AS (INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
       VALUES($1,'EXTRA_SERVICE','CASH',$2,'SUCCEEDED',$3,clock_timestamp(),$4) RETURNING id)
     INSERT INTO payment_allocations(payment_id,charge_id,amount) SELECT id,$5,$2 FROM p`,
    [bookingId, amount, randomUUID(), userId, chargeId],
  );
  await rows('UPDATE bookings SET paid_amount=paid_amount+$2,balance_due=0 WHERE id=$1', [
    bookingId,
    amount,
  ]);
}

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

test('phát sinh chưa thu là nghĩa vụ thật; hai dòng giống nhau cộng số lượng, không ghi thiếu', async () => {
  const seed = await checkedIn(q1);
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const response = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    extras: [
      { description: 'Nước suối', amount: 20_000, quantity: 2 },
      { description: 'Nước suối', amount: 20_000, quantity: 3 },
    ],
  });
  expect([409, 422]).toContain(response.status);
  expect(await charges(seed.id, 'EXTRA_SERVICE')).toEqual([
    expect.objectContaining({ amount: '100000', reason: 'Nước suối', voided_amount: '0' }),
  ]);
  expect(await bookingRow(seed.id)).toMatchObject({
    status: 'CHECKED_IN',
    balance_due: '100000',
  });
  expect(await unreleased(seed.bookingRoomId)).toHaveLength(1);
  expect(await roomTasks(q1, D)).toEqual([]);
  expect(await checkoutAuditCount(seed.id)).toBe(0);
});

test('thu đủ phát sinh rồi thử lại → CHECKED_OUT, giải phóng, đúng một việc dọn', async () => {
  const seed = await checkedIn(q1);
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const extras = [{ description: 'Nước suối', amount: 40_000, quantity: 1 }];
  const first = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    extras,
  });
  expect([409, 422]).toContain(first.status);
  const extra = (await charges(seed.id, 'EXTRA_SERVICE'))[0]!;
  await settle(seed.id, String(extra.id), 40_000);
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

test('trả sớm FLEX7 ≥72h → CHECKED_OUT + hoàn 50% min(paid, đêm chưa ở)', async () => {
  // 4 đêm 09–12/11 (đêm D−1 đã ở); clock 10/11 11:30 ⇒ báo trước 72.5h ≥ 72h.
  const seed = await checkedIn(q1, 4 * NIGHTLY, day(D, -1), day(D, 3));
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
  // Cơ sở = min(4.400.000, 3 đêm chưa ở 3.300.000) = 3.300.000 ⇒ hoàn 50% = 1.650.000.
  expect(await bookingRow(seed.id)).toMatchObject({
    status: 'CHECKED_OUT',
    total_amount: String(NIGHTLY),
    balance_due: '0',
  });
  expect(await refunds(seed.id)).toEqual([
    expect.objectContaining({
      status: 'PENDING',
      reason: 'EARLY_CHECKOUT',
      requested_amount: String((3 * NIGHTLY) / 2),
      refund_percent: '50.00',
      applied_tier_id: null,
    }),
  ]);
  expect((await charges(seed.id, 'ROOM')).map((row) => row.voided_amount)).toEqual([
    '0',
    String(NIGHTLY),
    String(NIGHTLY),
    String(NIGHTLY),
  ]);
  expect(await roomTasks(q1, D)).toHaveLength(1);
  expect(await unreleased(seed.bookingRoomId)).toEqual([]);
});

test('trả sớm dưới ngưỡng 72h → 0% (không lập yêu cầu hoàn) nhưng vẫn void đêm chưa ở', async () => {
  const seed = await checkedIn(q1, 2 * NIGHTLY, day(D, -1), day(D, 1));
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const response = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    earlyCheckOut: true,
  });
  expect(response.status).toBe(200);
  expect(await refunds(seed.id)).toEqual([]);
  expect((await charges(seed.id, 'ROOM')).map((row) => row.voided_amount)).toEqual([
    '0',
    String(NIGHTLY),
  ]);
  expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_OUT', balance_due: '0' });
});

test('NONREF (freeHours = null) → 0% ở mọi mốc', async () => {
  const seed = await checkedIn(q1, 4 * NIGHTLY, day(D, -1), day(D, 3), { policy: 'NONREF' });
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const response = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    earlyCheckOut: true,
  });
  expect(response.status).toBe(200);
  expect(await refunds(seed.id)).toEqual([]);
  expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_OUT' });
});

test('khách mới đóng cọc: hoàn đúng trần tiền đã nhả (không 500 LEDGER_SOURCE_CAP)', async () => {
  // 4 đêm × 400.000; đã thu 907.000 ⇒ đêm đầu 400.000, đêm chưa ở nhả 507.000.
  // Cơ sở min(907.000, 1.200.000) = 907.000 ⇒ 50% = 453.500 → làm tròn xuống 453.000 ≤ 507.000.
  const seed = await checkedIn(q1, 907_000, day(D, -1), day(D, 3), { nightly: 400_000 });
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const response = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    earlyCheckOut: true,
  });
  expect(response.status).toBe(200);
  expect(await refunds(seed.id)).toEqual([
    expect.objectContaining({ requested_amount: '453000', refund_percent: '50.00' }),
  ]);
});

test('hoàn bị chặn trên bởi tiền thực nhả khi công thức vượt quá', async () => {
  // 4 đêm × 400.000; đã thu 700.000 ⇒ nhả 300.000; công thức 50% × 700.000 = 350.000 ⇒ hoàn 300.000.
  const seed = await checkedIn(q1, 700_000, day(D, -1), day(D, 3), { nightly: 400_000 });
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const response = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    earlyCheckOut: true,
  });
  expect(response.status).toBe(200);
  expect(await refunds(seed.id)).toEqual([
    expect.objectContaining({ requested_amount: '300000', refund_percent: '50.00' }),
  ]);
});

test('snapshot cũ thiếu earlyCheckout* → 422, không void, không giải phóng', async () => {
  const seed = await checkedIn(q1, 4 * NIGHTLY, day(D, -1), day(D, 3), { earlyConfig: false });
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const response = await post(token, {
    ...checkOutBody(seed, await mintPin(token, seed.id)),
    earlyCheckOut: true,
  });
  expect(response.status).toBe(422);
  expect(errorCode(response)).toBe('E_RATE_CONFIGURATION_INVALID');
  expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_IN' });
  expect((await charges(seed.id, 'ROOM')).every((row) => row.voided_amount === '0')).toBe(true);
  expect(await unreleased(seed.bookingRoomId)).toHaveLength(1);
  expect(await roomTasks(q1, D)).toEqual([]);
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

test('feeAmount đọc lại từ sổ: phụ thu đã thu không bị engine tính lại theo giờ mới', async () => {
  const seed = await checkedIn(q1);
  clock.value = vn(D, '15:00:00');
  const token = await staffToken('FRONT_DESK');
  const first = await post(token, checkOutBody(seed, await mintPin(token, seed.id)));
  expect([409, 422]).toContain(first.status);
  const fee = (await charges(seed.id, 'EXTRA_SERVICE'))[0]!;
  expect(fee.amount).toBe('550000');
  await settle(seed.id, String(fee.id), 550_000);

  clock.value = vn(D, '19:00:00');
  // Token 15 phút tính theo CLOCK: nhảy mốc 4 giờ phải đăng nhập lại.
  const laterToken = await staffToken('FRONT_DESK');
  const second = await post(laterToken, checkOutBody(seed, await mintPin(laterToken, seed.id)));
  expect(second.status).toBe(200);
  // 19:00 engine tính 100% = 1.100.000, nhưng dòng đã có phân bổ nên giữ 550.000.
  expect(checkOutResponseSchema.parse(second.body).feeAmount).toBe(550_000);
  expect((await charges(seed.id, 'EXTRA_SERVICE'))[0]!.amount).toBe('550000');
});

test('việc dọn DONE/INSPECTED của cùng ngày được mở lại PENDING', async () => {
  const seed = await checkedIn(q1);
  await rows(
    "INSERT INTO housekeeping_tasks(room_id,business_date,status,completed_at) VALUES($1,$2,'DONE',clock_timestamp())",
    [q1, D],
  );
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const response = await post(token, checkOutBody(seed, await mintPin(token, seed.id)));
  expect(response.status).toBe(200);
  expect(
    await rows(
      'SELECT status,completed_at FROM housekeeping_tasks WHERE room_id=$1 AND business_date=$2',
      [q1, D],
    ),
  ).toEqual([{ status: 'PENDING', completed_at: null }]);
  expect(await roomTasks(q1, D)).toHaveLength(1);
});

test('replay sau khi mất phản hồi (claim bị dọn) → 200 dựng lại từ sổ, không 409', async () => {
  const seed = await checkedIn(q1);
  clock.value = vn(D, '11:30:00');
  const token = await staffToken('FRONT_DESK');
  const body = checkOutBody(seed, await mintPin(token, seed.id));
  const key = randomUUID();
  const first = await postWith(token, body, key);
  expect(first.status).toBe(200);
  // Transaction nghiệp vụ đã commit nhưng dòng idempotency bị dọn như nhánh lỗi HB-029.
  await rows('DELETE FROM idempotency_keys');
  const replay = await postWith(token, body, key);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  expect(await roomTasks(q1, D)).toHaveLength(1);
  expect(await history(seed.id, 'CHECKED_OUT')).toHaveLength(1);
  expect(await outbox(seed.id)).toHaveLength(1);
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
