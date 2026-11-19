/**
 * HB-262 — đối soát theo **người thu** khác người chốt (UC-PAY-05, SCR-68).
 *
 * Lỗi: lệnh chốt luôn lấy chính người gọi làm người thu, mà chỉ ACCOUNTANT được chốt, trong khi tiền mặt do
 * lễ tân thu ⇒ kế toán thật chốt luôn ra `expectedCash = 0`. Test HB-150 che lỗi bằng cách cho **cùng một
 * người dùng** đổi vai sang ACCOUNTANT. Nay lệnh chốt nhận `collectorId`, và `GET /reconciliation/daily`
 * cho xem tổng tiền mặt theo người thu trong ngày VN.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import {
  errorBodySchema,
  reconciliationCloseResponseSchema,
  reconciliationDailySchema,
} from '@pinehill/contracts';
import {
  clock,
  collectRequest,
  createBooking,
  http,
  issueGuest,
  pinTokenFor,
  propertyId,
  rows,
  secondUserId,
  staffToken,
  userId,
} from '../thu-tien-tai-quay/fixture.js';

const code = (response: { body: unknown }) => errorBodySchema.parse(response.body).code;

const close = (body: object, token: string) =>
  http()
    .post('/api/v1/reconciliation/daily/close')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);

const daily = (token: string, businessDate: string) =>
  http()
    .get('/api/v1/reconciliation/daily')
    .query({ propertyId, businessDate })
    .set('Authorization', `Bearer ${token}`);

async function cashDeposit(token: string, phone: string, guestToken: string): Promise<number> {
  const { booking } = await createBooking({ token: guestToken, phone });
  await rows('UPDATE bookings SET hold_expires_at = $1 WHERE id = $2', [
    new Date(clock.now().getTime() + 3600_000),
    booking.id,
  ]);
  const paid = await collectRequest(
    {
      bookingId: booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: booking.depositAmount,
      pinToken: await pinTokenFor(token, booking.id),
    },
    { token },
  );
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);
  return booking.depositAmount;
}

test('kế toán (người khác) xem rồi chốt quỹ của lễ tân: số phải có là tiền lễ tân thu', async () => {
  const businessDate = '2026-10-30';
  clock.value = Date.parse(`${businessDate}T03:00:00.000Z`);
  const guest = await issueGuest('+84900000262', 'HB-262 Guest');
  const frontDesk = await staffToken('FRONT_DESK', 'h029-first');
  const amount = await cashDeposit(frontDesk, '0900000262', guest.token);

  const accountant = await staffToken('ACCOUNTANT', 'h029-second');
  const before = reconciliationDailySchema.parse((await daily(accountant, businessDate)).body);
  expect(before.collectors).toEqual([
    expect.objectContaining({
      collectorId: userId,
      cashReceiptCount: 1,
      expectedCash: amount,
      closed: null,
    }),
  ]);

  const response = await close(
    {
      propertyId,
      businessDate,
      collectorId: userId,
      countedCash: amount,
      pinToken: await pinTokenFor(accountant),
    },
    accountant,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const closed = reconciliationCloseResponseSchema.parse(response.body);
  expect(closed).toMatchObject({ expectedCash: amount, difference: 0, managerNotified: false });

  const [audit] = await rows('SELECT actor_id, after_json FROM audit_logs WHERE id = $1::uuid', [
    closed.auditLogId,
  ]);
  expect(audit?.actor_id).toBe(secondUserId);
  expect(z.object({ collectorId: z.string() }).parse(audit?.after_json).collectorId).toBe(userId);

  const after = reconciliationDailySchema.parse((await daily(accountant, businessDate)).body);
  expect(after.collectors[0]?.closed).toMatchObject({ countedCash: amount, difference: 0 });
  // Chốt lại cùng (người thu, ngày) ⇒ 409.
  const again = await close(
    {
      propertyId,
      businessDate,
      collectorId: userId,
      countedCash: amount,
      pinToken: await pinTokenFor(accountant),
    },
    accountant,
  );
  expect(again.status).toBe(409);
});

test('lễ tân chỉ xem được quỹ của mình và không tự chốt (tách nhiệm vụ)', async () => {
  const businessDate = '2026-10-29';
  clock.value = Date.parse(`${businessDate}T03:00:00.000Z`);
  const guest = await issueGuest('+84900000263', 'HB-262 Guest 2');
  const first = await staffToken('FRONT_DESK', 'h029-first');
  const second = await staffToken('FRONT_DESK', 'h029-second');
  const mine = await cashDeposit(first, '0900000263', guest.token);
  await cashDeposit(second, '0900000264', guest.token);

  const own = reconciliationDailySchema.parse((await daily(first, businessDate)).body);
  expect(own.collectors.map((row) => [row.collectorId, row.expectedCash])).toEqual([
    [userId, mine],
  ]);
  const refused = await close(
    { propertyId, businessDate, countedCash: mine, pinToken: await pinTokenFor(first) },
    first,
  );
  expect(refused.status).toBe(403);
});

test('người thu không tồn tại ⇒ 404; ngày sai dạng ⇒ 400', async () => {
  const businessDate = '2026-10-28';
  clock.value = Date.parse(`${businessDate}T03:00:00.000Z`);
  const accountant = await staffToken('ACCOUNTANT', 'h029-second');
  const unknown = await close(
    {
      propertyId,
      businessDate,
      collectorId: randomUUID(),
      countedCash: 0,
      pinToken: await pinTokenFor(accountant),
    },
    accountant,
  );
  expect(unknown.status).toBe(404);
  expect(code(unknown)).toBe('E_GEN_NOT_FOUND');
  expect((await daily(accountant, '03-11-2026')).status).toBe(400);
});
