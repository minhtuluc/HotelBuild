/**
 * HB-215 — xác nhận chuyển khoản hoàn tiền tay: tiền chỉ rời hệ thống khi có **mã tham chiếu ngân
 * hàng** do người khác người duyệt nhập, chốt trong **một** transaction (audit + outbox + PAID).
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test } from 'vitest';
import { z } from 'zod';
import {
  listResponseSchema,
  refundPayoutViewSchema,
  refundRequestSchema,
  type RefundPayoutView,
  type RefundRequest,
} from '@pinehill/contracts';
import {
  booking,
  errorCode,
  flexPolicy,
  http,
  login,
  pinToken,
  propertyId,
  refundRequests,
  rows,
  userId,
} from './fixture.js';

const AMOUNT = 2_000_000;
const BANK_NOTE = 'STK 999888777 — NGUYEN VAN A';
const BANK_REFERENCE = 'FT-20261026-0001';

/** `audit_logs.after_json` của `REFUND_TRANSFER_CONFIRMED` (hợp đồng bằng chứng, HB-215). */
const transferAuditSchema = z.object({
  bankReference: z.string(),
  status: z.string(),
  operations: z.array(
    z.object({ operationId: z.string(), amount: z.string(), method: z.string() }),
  ),
});

/** `outbox_events.payload_json` của `RefundPaid` (cùng hình dạng worker phát). */
const refundPaidSchema = z.object({
  amount: z.string(),
  legs: z.array(z.object({ amount: z.string() })),
});

/** Bậc ≥7 ngày quyết định `refundPercent` của mọi hồ sơ trong tệp này. */
async function setTier(percent: number): Promise<void> {
  const policy = String(
    (await rows("SELECT cancellation_policy_id AS id FROM rate_plans WHERE code='FLEX7'"))[0]!.id,
  );
  await rows(
    'UPDATE cancellation_tiers SET refund_percent=$2 WHERE policy_id=$1::uuid AND offset_hours=168',
    [policy, percent],
  );
}

beforeEach(async () => {
  await flexPolicy();
  await setTier(100);
});

/** Chứng từ thu **chưa phân bổ** (đủ quỹ giữ hạn mức hoàn) theo phương thức gốc của ca. */
async function receipt(bookingId: string, method: 'CASH' | 'VNPAY'): Promise<string> {
  return String(
    (
      await rows(
        `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
         VALUES($1::uuid,'DEPOSIT',$2,$3,'SUCCEEDED',$4,clock_timestamp(),$5::uuid)
         RETURNING id`,
        [bookingId, method, AMOUNT, randomUUID(), userId],
      )
    )[0]!.id,
  );
}

const openRefund = (token: string, body: object) =>
  http()
    .post('/api/v1/refund-requests')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);

const approve = (token: string, id: string, body: object) =>
  http()
    .post(`/api/v1/refund-requests/${id}/approve`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);

const pay = (token: string, id: string, body: object) =>
  http()
    .post(`/api/v1/refund-requests/${id}/pay`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);

const confirm = (token: string, id: string, body: object) =>
  http()
    .post(`/api/v1/refund-requests/${id}/confirm-transfer`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);

/** Hồ sơ `APPROVED` từ chứng từ tiền mặt (chi hoàn bằng chuyển khoản tay — BR-PAY-08). */
async function approvedRefund(): Promise<{
  bookingId: string;
  refundId: string;
  netRefund: number;
}> {
  const created = await booking({ status: 'CONFIRMED', price: AMOUNT, nights: 3 });
  const paymentId = await receipt(created.id, 'CASH');
  const maker = await login('h029-first', 'FRONT_DESK');
  const opened = await openRefund(maker, {
    bookingId: created.id,
    paymentId,
    reason: 'GUEST_REQUEST',
    isForceMajeure: false,
  });
  expect(opened.status).toBe(201);
  const view = refundRequestSchema.parse(opened.body);
  const checker = await login('h029-second', 'MANAGER');
  const checkerPin = await pinToken(checker, created.id);
  const approved = await approve(checker, view.id, {
    approvedAmount: view.requestedAmount,
    pinToken: checkerPin,
  });
  expect(approved.status).toBe(200);
  return { bookingId: created.id, refundId: view.id, netRefund: view.netRefund ?? 0 };
}

/** Tạo leg `READY` bằng `/pay` rồi mô phỏng worker dừng chờ đối soát tay (HB-100 `psp.ts`). */
async function parkedRefund() {
  const refund = await approvedRefund();
  const cashier = await login('h029-first', 'ACCOUNTANT');
  const payPin = await pinToken(cashier, refund.bookingId);
  const started = await pay(cashier, refund.refundId, {
    method: 'BANK_TRANSFER',
    bankNote: BANK_NOTE,
    pinToken: payPin,
  });
  expect(started.status).toBe(202);
  await rows(
    `UPDATE refund_payout_operations
        SET status = 'UNKNOWN', last_error = 'MANUAL_TRANSFER_AWAITING_CONFIRMATION',
            updated_at = clock_timestamp()
      WHERE refund_request_id = $1::uuid`,
    [refund.refundId],
  );
  return { ...refund, cashier };
}

const operations = (refundId: string) =>
  rows('SELECT * FROM refund_payout_operations WHERE refund_request_id=$1::uuid', [refundId]);

const refundPayments = (bookingId: string) =>
  rows("SELECT * FROM payments WHERE booking_id=$1::uuid AND type='REFUND'", [bookingId]);

const transferAudits = (refundId: string) =>
  rows("SELECT * FROM audit_logs WHERE action='REFUND_TRANSFER_CONFIRMED' AND entity_id=$1::uuid", [
    refundId,
  ]);

const paidEvents = (refundId: string) =>
  rows("SELECT * FROM outbox_events WHERE event_type='RefundPaid' AND aggregate_id=$1::uuid", [
    refundId,
  ]);

async function refundList(token: string, bookingId: string): Promise<readonly RefundRequest[]> {
  const response = await http()
    .get('/api/v1/refund-requests')
    .query({ bookingId })
    .set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  return listResponseSchema(refundRequestSchema).parse(response.body).data;
}

test('xác nhận chuyển khoản: hồ sơ PAID có bằng chứng, audit + outbox đúng một trong cùng transaction', async () => {
  const refund = await parkedRefund();
  // Trước khi xác nhận: server báo leg đang chờ xác nhận (SCR-38 dựa vào cờ này).
  expect(
    (await refundList(refund.cashier, refund.bookingId)).find((row) => row.id === refund.refundId),
  ).toMatchObject({ status: 'APPROVED', awaitingTransferConfirmation: true });

  const pin = await pinToken(refund.cashier, refund.bookingId);
  const confirmed = await confirm(refund.cashier, refund.refundId, {
    bankReference: ` ${BANK_REFERENCE} `,
    note: 'Đã chuyển khoản VCB ngày 26/10',
    pinToken: pin,
  });
  expect(confirmed.status).toBe(200);
  const view: RefundPayoutView = refundPayoutViewSchema.parse(confirmed.body);
  expect(view.refundRequestId).toBe(refund.refundId);
  expect(view.status).toBe('PAID');
  expect(view.operations).toHaveLength(1);
  expect(view.operations[0]).toMatchObject({
    status: 'SUCCEEDED',
    method: 'BANK_TRANSFER',
    amount: refund.netRefund,
    providerTxnId: BANK_REFERENCE,
    lastError: null,
  });
  expect(view.operations[0]!.finishedAt).not.toBeNull();

  const [request] = await refundRequests(refund.bookingId);
  expect(request).toMatchObject({ status: 'PAID' });
  expect(request!.paid_at).not.toBeNull();

  const payments = await refundPayments(refund.bookingId);
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({
    status: 'SUCCEEDED',
    method: 'BANK_TRANSFER',
    provider_txn_id: BANK_REFERENCE,
    amount: String(-refund.netRefund),
  });
  expect(payments[0]!.paid_at).not.toBeNull();

  const [bookingRow] = await rows('SELECT refunded_amount FROM bookings WHERE id=$1::uuid', [
    refund.bookingId,
  ]);
  expect(String(bookingRow!.refunded_amount)).toBe(String(refund.netRefund));

  const audits = await transferAudits(refund.refundId);
  expect(audits).toHaveLength(1);
  const after = transferAuditSchema.parse(audits[0]!.after_json);
  expect(after).toMatchObject({ bankReference: BANK_REFERENCE, status: 'PAID' });
  expect(after.operations).toEqual([
    {
      operationId: view.operations[0]!.id,
      amount: String(refund.netRefund),
      method: 'BANK_TRANSFER',
    },
  ]);
  // Không lộ số tài khoản thô (`bankNote`) hay `pinToken` trong nhật ký.
  expect(JSON.stringify(after)).not.toContain('999888777');
  expect(JSON.stringify(after)).not.toContain('pinToken');

  const events = await paidEvents(refund.refundId);
  expect(events).toHaveLength(1);
  const payload = refundPaidSchema.parse(events[0]!.payload_json);
  expect(payload.amount).toBe(String(refund.netRefund));
  expect(payload.legs.reduce((sum, leg) => sum + BigInt(leg.amount), 0n)).toBe(
    BigInt(refund.netRefund),
  );

  expect(
    (await refundList(refund.cashier, refund.bookingId)).find((row) => row.id === refund.refundId),
  ).toMatchObject({ status: 'PAID', awaitingTransferConfirmation: false });
});

test('thiếu mã tham chiếu, hoặc thiếu cả note lẫn evidence: 400 và không đổi trạng thái', async () => {
  const refund = await parkedRefund();
  const pin = await pinToken(refund.cashier, refund.bookingId);
  for (const body of [
    { note: 'Đã chuyển khoản', pinToken: pin },
    { bankReference: '   ', note: 'Đã chuyển khoản', pinToken: pin },
    { bankReference: BANK_REFERENCE, pinToken: pin },
    { bankReference: BANK_REFERENCE, note: '   ', evidenceRefs: [], pinToken: pin },
  ]) {
    const refused = await confirm(refund.cashier, refund.refundId, body);
    expect(refused.status).toBe(400);
    expect(errorCode(refused.body)).toBe('E_GEN_VALIDATION_FAILED');
  }
  expect((await refundRequests(refund.bookingId))[0]).toMatchObject({ status: 'APPROVED' });
  expect((await operations(refund.refundId))[0]).toMatchObject({
    status: 'UNKNOWN',
    last_error: 'MANUAL_TRANSFER_AWAITING_CONFIRMATION',
  });
  expect((await refundPayments(refund.bookingId))[0]).toMatchObject({ status: 'PENDING' });
  expect(await transferAudits(refund.refundId)).toHaveLength(0);
  expect(await paidEvents(refund.refundId)).toHaveLength(0);
});

test('hồ sơ PENDING/không có leg chờ xác nhận: 409 E_PAY_REFUND_NOT_PENDING', async () => {
  const created = await booking({ status: 'CONFIRMED', price: AMOUNT, nights: 3 });
  const paymentId = await receipt(created.id, 'CASH');
  const maker = await login('h029-first', 'FRONT_DESK');
  const opened = await openRefund(maker, {
    bookingId: created.id,
    paymentId,
    reason: 'GUEST_REQUEST',
    isForceMajeure: false,
  });
  expect(opened.status).toBe(201);
  const view = refundRequestSchema.parse(opened.body);
  const cashier = await login('h029-first', 'ACCOUNTANT');
  const pin = await pinToken(cashier, created.id);
  const refused = await confirm(cashier, view.id, {
    bankReference: BANK_REFERENCE,
    note: 'Đã chuyển khoản',
    pinToken: pin,
  });
  expect(refused.status).toBe(409);
  expect(errorCode(refused.body)).toBe('E_PAY_REFUND_NOT_PENDING');
  expect(await operations(view.id)).toHaveLength(0);
});

test('người duyệt hồ sơ không được tự xác nhận đã chuyển khoản', async () => {
  const refund = await parkedRefund();
  const approverAsCashier = await login('h029-second', 'ACCOUNTANT');
  const pin = await pinToken(approverAsCashier, refund.bookingId);
  const refused = await confirm(approverAsCashier, refund.refundId, {
    bankReference: BANK_REFERENCE,
    note: 'Tự xác nhận',
    pinToken: pin,
  });
  expect(refused.status).toBe(403);
  expect(errorCode(refused.body)).toBe('E_PAY_SELF_APPROVAL');
  expect((await refundRequests(refund.bookingId))[0]).toMatchObject({ status: 'APPROVED' });
  expect((await operations(refund.refundId))[0]).toMatchObject({ status: 'UNKNOWN' });
});

test('gửi lại cùng mã trả đúng view, không sinh chứng từ/audit thứ hai; mã khác là 409', async () => {
  const refund = await parkedRefund();
  const first = await confirm(refund.cashier, refund.refundId, {
    bankReference: BANK_REFERENCE,
    note: 'Đã chuyển khoản',
    pinToken: await pinToken(refund.cashier, refund.bookingId),
  });
  expect(first.status).toBe(200);
  const replayPin = await pinToken(refund.cashier, refund.bookingId);
  const replay = await confirm(refund.cashier, refund.refundId, {
    bankReference: BANK_REFERENCE,
    note: 'Đã chuyển khoản',
    pinToken: replayPin,
  });
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  expect(await transferAudits(refund.refundId)).toHaveLength(1);
  expect(await refundPayments(refund.bookingId)).toHaveLength(1);
  expect(await operations(refund.refundId)).toHaveLength(1);

  const otherPin = await pinToken(refund.cashier, refund.bookingId);
  const conflict = await confirm(refund.cashier, refund.refundId, {
    bankReference: 'FT-20261026-9999',
    note: 'Mã khác',
    pinToken: otherPin,
  });
  expect(conflict.status).toBe(409);
  expect(errorCode(conflict.body)).toBe('E_PAY_REFUND_NOT_PENDING');
  expect(await transferAudits(refund.refundId)).toHaveLength(1);
});

test('kế toán ngoài phạm vi cơ sở bị chặn 403 trước khi chốt tiền', async () => {
  const refund = await parkedRefund();
  const pin = await pinToken(refund.cashier, refund.bookingId);
  await rows(
    "DELETE FROM user_property_scopes WHERE user_id=(SELECT id FROM users WHERE username='h029-first')",
  );
  try {
    const refused = await confirm(refund.cashier, refund.refundId, {
      bankReference: BANK_REFERENCE,
      note: 'Ngoài phạm vi',
      pinToken: pin,
    });
    expect(refused.status).toBe(403);
    expect(errorCode(refused.body)).toBe('E_RBAC_FORBIDDEN');
  } finally {
    await rows(
      'INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid) ON CONFLICT DO NOTHING',
      [userId, propertyId],
    );
  }
  expect((await operations(refund.refundId))[0]).toMatchObject({ status: 'UNKNOWN' });
});

test('PIN thiếu hoặc đã tiêu thụ: 401 E_AUTH_PIN_REQUIRED như lệnh chi hiện có', async () => {
  const refund = await parkedRefund();
  const missing = await confirm(refund.cashier, refund.refundId, {
    bankReference: BANK_REFERENCE,
    note: 'Đã chuyển khoản',
  });
  expect(missing.status).toBe(401);
  expect(errorCode(missing.body)).toBe('E_AUTH_PIN_REQUIRED');

  const pin = await pinToken(refund.cashier, refund.bookingId);
  const ok = await confirm(refund.cashier, refund.refundId, {
    bankReference: BANK_REFERENCE,
    note: 'Đã chuyển khoản',
    pinToken: pin,
  });
  expect(ok.status).toBe(200);
  expect(refundPayoutViewSchema.parse(ok.body).status).toBe('PAID');

  const reused = await confirm(refund.cashier, refund.refundId, {
    bankReference: BANK_REFERENCE,
    note: 'Đã chuyển khoản',
    pinToken: pin,
  });
  expect(reused.status).toBe(401);
  expect(errorCode(reused.body)).toBe('E_AUTH_PIN_REQUIRED');
});
