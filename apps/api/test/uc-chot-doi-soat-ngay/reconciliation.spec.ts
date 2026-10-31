/**
 * HB-150 — `POST /reconciliation/daily/close` chốt đối soát ngày theo `(người thu, ngày VN)`
 * (UC-PAY-05; BR-PAY-06, BR-PAY-10; api.md §2.6, §6.1).
 *
 * Nghiệm thu:
 * 1. Tổng thu tiền mặt (`method = 'CASH'`, `status = 'SUCCEEDED'`) theo `(người thu, ngày VN)` đọc và
 *    đối chiếu qua sổ cái HB-093 (`BookingLedger.read`), loại trừ chuyển khoản/PSP, người thu khác và
 *    ngày VN khác;
 * 2. `countedCash` lệch quá ngưỡng (`system_settings` hoặc mặc định `50_000` VND) ⇒ `managerNotified = true`,
 *    tạo thông báo cho `MANAGER` kèm danh sách giao dịch liên quan và ghi chênh lệch vào `AuditLog`;
 * 3. Chốt lần hai cùng `(người thu, cơ sở, ngày VN)` ⇒ `409 E_BOOK_INVALID_STATE`; đòi `pinToken` một lần;
 *    replay cùng `Idempotency-Key` trả lại đúng kết quả cũ (`Idempotency-Replayed: true`).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import {
  errorBodySchema,
  paymentSchema,
  reconciliationCloseResponseSchema,
} from '@pinehill/contracts';
import {
  clock,
  collectRequest,
  createBooking,
  http,
  issueGuest,
  otherPropertyId,
  pinTokenFor,
  propertyId,
  rows,
  secondUserId,
  staffToken,
  userId,
} from '../thu-tien-tai-quay/fixture.js';

const code = (response: { body: unknown }) => errorBodySchema.parse(response.body).code;

function closeRequest(body: object, options: { token?: string | null; key?: string | null } = {}) {
  const call = http().post('/api/v1/reconciliation/daily/close');
  if (options.token !== null && options.token !== undefined)
    call.set('Authorization', `Bearer ${options.token}`);
  if (options.key !== null) call.set('Idempotency-Key', options.key ?? randomUUID());
  return call.send(body);
}

async function createCollectibleBooking(options: Parameters<typeof createBooking>[0] = {}) {
  const result = await createBooking(options);
  await rows('UPDATE bookings SET hold_expires_at = $1 WHERE id = $2', [
    new Date(clock.now().getTime() + 3600_000),
    result.booking.id,
  ]);
  return result;
}

/** Ngày nghiệp vụ theo múi giờ Việt Nam (`Asia/Ho_Chi_Minh`, UTC+7) của đồng hồ giả lập hiện hành. */
function currentVnBusinessDate(): string {
  const vnTime = new Date(clock.now().getTime() + 7 * 3600 * 1000);
  return vnTime.toISOString().slice(0, 10);
}

test('AC1: tổng thu tiền mặt theo (người thu, ngày VN) khớp sổ cái HB-093; lệch trong ngưỡng ⇒ managerNotified = false', async () => {
  const businessDate = '2026-11-01';
  // Đặt đồng hồ về 2026-11-01 10:00:00 giờ VN (03:00:00 UTC) trước khi phát token
  clock.value = Date.parse(`${businessDate}T03:00:00.000Z`);
  const token = await staffToken('FRONT_DESK', 'h029-first');
  const secondToken = await staffToken('FRONT_DESK', 'h029-second');
  const guest = await issueGuest('+84900000150', 'HB-150 Guest 1');

  const first = await createCollectibleBooking({ token: guest.token, phone: '0900000151' });
  const second = await createCollectibleBooking({ token: guest.token, phone: '0900000152' });
  const third = await createCollectibleBooking({ token: guest.token, phone: '0900000153' });

  // Khoản 1: tiền mặt do h029-first thu trong ngày 2026-11-01
  const pin1 = await pinTokenFor(token, first.booking.id);
  const pay1 = await collectRequest(
    {
      bookingId: first.booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: first.booking.depositAmount,
      pinToken: pin1,
    },
    { token },
  );
  expect(pay1.status).toBe(201);
  const payment1 = paymentSchema.parse(pay1.body);

  // Khoản 2: chuyển khoản ngân hàng do h029-first thu (không tính vào quỹ tiền mặt)
  const pin2 = await pinTokenFor(token, second.booking.id);
  const pay2 = await collectRequest(
    {
      bookingId: second.booking.id,
      type: 'DEPOSIT',
      method: 'BANK_TRANSFER',
      amount: second.booking.depositAmount,
      pinToken: pin2,
    },
    { token },
  );
  expect(pay2.status).toBe(201);

  // Khoản 3: tiền mặt do h029-second thu (người thu khác — không cộng vào của h029-first)
  const pin3 = await pinTokenFor(secondToken, third.booking.id);
  const pay3 = await collectRequest(
    {
      bookingId: third.booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: third.booking.depositAmount,
      pinToken: pin3,
    },
    { token: secondToken },
  );
  expect(pay3.status).toBe(201);

  // Chốt đối soát của h029-first với chênh lệch +30.000 VND (≤ ngưỡng 50.000 VND)
  const closePin = await pinTokenFor(token);
  const countedCash = first.booking.depositAmount + 30_000;
  const response = await closeRequest(
    {
      propertyId,
      businessDate,
      countedCash,
      note: 'Chốt quỹ cuối ngày lễ tân ca sáng',
      pinToken: closePin,
    },
    { token },
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const closed = reconciliationCloseResponseSchema.parse(response.body);
  expect(closed.propertyId).toBe(propertyId);
  expect(closed.businessDate).toBe(businessDate);
  expect(closed.expectedCash).toBe(first.booking.depositAmount);
  expect(closed.countedCash).toBe(countedCash);
  expect(closed.difference).toBe(30_000);
  expect(closed.managerNotified).toBe(false);

  const auditRows = await rows(
    'SELECT id, action, after_json FROM audit_logs WHERE id = $1::uuid',
    [closed.auditLogId],
  );
  expect(auditRows.length).toBe(1);
  expect(auditRows[0]!.action).toBe('RECONCILIATION_DAILY_CLOSED');
  const snapshot = z
    .object({
      expectedCash: z.number(),
      countedCash: z.number(),
      difference: z.number(),
      managerNotified: z.boolean(),
      paymentIds: z.array(z.string()),
    })
    .parse(auditRows[0]!.after_json);
  expect(snapshot.expectedCash).toBe(first.booking.depositAmount);
  expect(snapshot.countedCash).toBe(countedCash);
  expect(snapshot.difference).toBe(30_000);
  expect(snapshot.managerNotified).toBe(false);
  expect(snapshot.paymentIds).toEqual([payment1.paymentId]);
});

test('AC1: countedCash lệch quá ngưỡng tham số hệ thống ⇒ managerNotified = true + thông báo MANAGER kèm danh sách giao dịch', async () => {
  const businessDate = '2026-11-02';
  // Đặt mốc 23:30 giờ VN ngày 2026-11-02 (16:30 UTC ngày 2026-11-02 — kiểm chứng quy đổi múi giờ VN)
  clock.value = Date.parse('2026-11-02T16:30:00.000Z');
  expect(currentVnBusinessDate()).toBe(businessDate);

  const fdToken = await staffToken('FRONT_DESK', 'h029-first');
  const guest = await issueGuest('+84900000155', 'HB-150 Guest 2');
  const { booking } = await createCollectibleBooking({ token: guest.token, phone: '0900000154' });
  const collectPin = await pinTokenFor(fdToken, booking.id);
  const collected = await collectRequest(
    {
      bookingId: booking.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: booking.depositAmount,
      pinToken: collectPin,
    },
    { token: fdToken },
  );
  expect(collected.status).toBe(201);
  const payment = paymentSchema.parse(collected.body);

  // Tuỳ chỉnh ngưỡng lệch trong system_settings = 40.000 VND
  await rows(
    `INSERT INTO system_settings(key, value, value_type, description)
     VALUES ('reconciliation.cashDiscrepancyThreshold', '40000', 'NUMBER', 'Ngưỡng lệch quỹ tiền mặt')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );

  // Kế toán (hoặc chính người thu) đối soát thiếu 45.000 VND (> 40.000 VND)
  const accountantToken = await staffToken('ACCOUNTANT', 'h029-first');
  const closePin = await pinTokenFor(accountantToken);
  const countedCash = booking.depositAmount - 45_000;

  const response = await closeRequest(
    {
      propertyId,
      businessDate,
      countedCash,
      note: 'Thiếu tiền lẻ cuối ngày',
      pinToken: closePin,
    },
    { token: accountantToken },
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const body = reconciliationCloseResponseSchema.parse(response.body);
  expect(body.expectedCash).toBe(booking.depositAmount);
  expect(body.countedCash).toBe(countedCash);
  expect(body.difference).toBe(-45_000);
  expect(body.managerNotified).toBe(true);

  const notifications = await rows(
    `SELECT recipient, template, payload_json
       FROM notifications
      WHERE template = 'RECONCILIATION_CASH_DISCREPANCY'
        AND recipient = $1
      ORDER BY created_at DESC LIMIT 1`,
    [`MANAGER:${propertyId}`],
  );
  expect(notifications.length).toBe(1);
  const payload = z
    .object({
      propertyId: z.string(),
      businessDate: z.string(),
      collectorId: z.string(),
      difference: z.number(),
      paymentIds: z.array(z.string()),
    })
    .parse(notifications[0]!.payload_json);
  expect(payload.propertyId).toBe(propertyId);
  expect(payload.businessDate).toBe(businessDate);
  expect(payload.collectorId).toBe(userId);
  expect(payload.difference).toBe(-45_000);
  expect(payload.paymentIds).toEqual([payment.paymentId]);
});

test('AC2: chốt lần hai cùng (người thu, ngày VN) ⇒ 409; thiếu/sai pinToken ⇒ 401; replay cùng Idempotency-Key ⇒ 201', async () => {
  const businessDate = '2026-11-03';
  clock.value = Date.parse('2026-11-03T04:00:00.000Z');
  const token = await staffToken('ACCOUNTANT', 'h029-first');

  // 1. Thiếu pinToken ⇒ 401 E_AUTH_PIN_REQUIRED
  const missingPin = await closeRequest({ propertyId, businessDate, countedCash: 0 }, { token });
  expect(missingPin.status).toBe(401);
  expect(code(missingPin)).toBe('E_AUTH_PIN_REQUIRED');

  // 2. Chốt lần đầu thành công + phát lại cùng Idempotency-Key trả lại đúng kết quả
  const pin1 = await pinTokenFor(token);
  const idempotencyKey = randomUUID();
  const payload = {
    propertyId,
    businessDate,
    countedCash: 0,
    note: 'Không phát sinh thu tiền mặt',
    pinToken: pin1,
  };
  const firstClose = await closeRequest(payload, { token, key: idempotencyKey });
  expect(firstClose.status, JSON.stringify(firstClose.body)).toBe(201);
  const firstParsed = reconciliationCloseResponseSchema.parse(firstClose.body);

  const replayed = await closeRequest(payload, { token, key: idempotencyKey });
  expect(replayed.status).toBe(201);
  expect(replayed.headers['idempotency-replayed']).toBe('true');
  expect(reconciliationCloseResponseSchema.parse(replayed.body).auditLogId).toBe(
    firstParsed.auditLogId,
  );

  // 3. Chốt lần hai với Idempotency-Key mới cho cùng (người thu, ngày VN) ⇒ 409 E_BOOK_INVALID_STATE
  const pin2 = await pinTokenFor(token);
  const duplicateClose = await closeRequest(
    {
      propertyId,
      businessDate,
      countedCash: 0,
      pinToken: pin2,
    },
    { token },
  );
  expect(duplicateClose.status).toBe(409);
  expect(code(duplicateClose)).toBe('E_BOOK_INVALID_STATE');

  // 4. Người thu khác (`h029-second`) vẫn chốt được cùng ngày VN đó độc lập
  const secondToken = await staffToken('FRONT_DESK', 'h029-second');
  const secondPin = await pinTokenFor(secondToken);
  const otherCollectorClose = await closeRequest(
    {
      propertyId,
      businessDate,
      countedCash: 0,
      pinToken: secondPin,
    },
    { token: secondToken },
  );
  expect(otherCollectorClose.status).toBe(201);
  expect(secondUserId).not.toBe(userId);

  // 5. Cơ sở ngoài phạm vi ⇒ 403 E_AUTH_OUT_OF_SCOPE
  const outOfScopeResponse = await closeRequest(
    {
      propertyId: otherPropertyId,
      businessDate,
      countedCash: 0,
      pinToken: secondPin,
    },
    { token: secondToken },
  );
  expect(outOfScopeResponse.status).toBe(403);
  expect(code(outOfScopeResponse)).toBe('E_AUTH_OUT_OF_SCOPE');
});
