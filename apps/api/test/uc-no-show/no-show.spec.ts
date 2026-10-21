/**
 * HB-147 — bổ sung cho bộ khoá HB-143 (`apps/api/test/front-office/front-office.locked.spec.ts`).
 *
 * Bộ khoá đã phủ mốc 23:59, trạng thái, bậc + phạt và rollback; file này chỉ phủ những gì bộ khoá
 * **không** ghim: phát lại theo cùng `Idempotency-Key`, hai lệnh đua nhau, ma trận quyền và mã 404.
 * Dùng lại nguyên fixture/khoá HB-143 (chỉ đọc) để cùng một mô hình dữ liệu.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { noShowResponseSchema } from '@pinehill/contracts';
import {
  D,
  NO_SHOW,
  chargeIds,
  clock,
  errorCode,
  http,
  rows,
  seedBooking,
  staffToken,
  vn,
} from '../front-office/fixture.js';

const reason = 'Khách không đến';

function mark(token: string, bookingId: string) {
  return http()
    .post(NO_SHOW)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send({ bookingId, reason });
}

const penaltyRows = (bookingId: string) =>
  rows("SELECT id,status,amount FROM payments WHERE booking_id=$1 AND type='PENALTY'", [bookingId]);

test('cùng Idempotency-Key: phát lại nguyên phản hồi, không ghi khoản thứ hai', async () => {
  clock.value = vn(D, '23:59:00');
  const seed = await seedBooking({ paid: 300_000 });
  const token = await staffToken('FRONT_DESK');
  const key = randomUUID();
  const call = () =>
    http()
      .post(NO_SHOW)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ bookingId: seed.id, reason });

  const first = await call();
  expect(first.status).toBe(200);
  expect(noShowResponseSchema.parse(first.body)).toMatchObject({
    status: 'NO_SHOW',
    penaltyAmount: 800_000,
    refundRequestId: null,
  });
  const second = await call();
  expect(second.status).toBe(200);
  expect(second.headers['idempotency-replayed']).toBe('true');
  expect(second.body).toEqual(first.body);
  expect(await chargeIds(seed.id, 'PENALTY')).toHaveLength(1);
  expect(await penaltyRows(seed.id)).toMatchObject([{ status: 'PENDING', amount: '800000' }]);
});

test('hai lệnh đua nhau: đúng một lệnh thắng, chỉ một công nợ PENALTY', async () => {
  clock.value = vn(D, '23:59:00');
  const seed = await seedBooking({ paid: 300_000 });
  const token = await staffToken('FRONT_DESK');
  const [left, right] = await Promise.all([mark(token, seed.id), mark(token, seed.id)]);
  expect([left.status, right.status].sort()).toEqual([200, 409]);
  const loser = left.status === 409 ? left : right;
  expect(errorCode(loser)).toBe('E_BOOK_INVALID_STATE');
  expect(await chargeIds(seed.id, 'PENALTY')).toHaveLength(1);
  expect(await penaltyRows(seed.id)).toHaveLength(1);
});

test('MANAGER và OWNER cũng ghi được; vai trò khác bị chặn', async () => {
  clock.value = vn(D, '23:59:00');
  for (const role of ['MANAGER', 'OWNER']) {
    const seed = await seedBooking();
    const response = await mark(await staffToken(role), seed.id);
    expect(response.status, role).toBe(200);
    expect(noShowResponseSchema.parse(response.body).status).toBe('NO_SHOW');
  }
  for (const role of ['RESERVATION_AGENT', 'ACCOUNTANT', 'HOUSEKEEPING']) {
    const seed = await seedBooking();
    const response = await mark(await staffToken(role), seed.id);
    expect(response.status, role).toBe(403);
    expect(errorCode(response)).toBe('E_RBAC_FORBIDDEN');
    expect(await chargeIds(seed.id, 'PENALTY')).toEqual([]);
  }
});

test('booking không tồn tại → 404, không ghi idempotency key hoàn tất', async () => {
  clock.value = vn(D, '23:59:00');
  const token = await staffToken('FRONT_DESK');
  const response = await mark(token, randomUUID());
  expect(response.status).toBe(404);
  expect(errorCode(response)).toBe('E_GEN_NOT_FOUND');
  expect(await rows("SELECT id FROM idempotency_keys WHERE status='COMPLETED'")).toEqual([]);
});

test('thiếu lý do hoặc sai kiểu → 400 trước khi chạm dữ liệu', async () => {
  clock.value = vn(D, '23:59:00');
  const seed = await seedBooking();
  const token = await staffToken('FRONT_DESK');
  for (const body of [
    { bookingId: seed.id },
    { bookingId: 'not-a-uuid', reason },
    {
      bookingId: seed.id,
      reason,
      extra: true,
    },
  ]) {
    const response = await http()
      .post(NO_SHOW)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe('E_GEN_VALIDATION_FAILED');
  }
  const [booking] = await rows('SELECT status FROM bookings WHERE id=$1', [seed.id]);
  expect(booking).toEqual({ status: 'CONFIRMED' });
});
