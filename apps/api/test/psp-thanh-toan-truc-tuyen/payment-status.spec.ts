/**
 * HB-094 — `GET /payments/{paymentId}/status`: chỉ đọc CSDL, **không** gọi PSP mỗi lần poll (AC3,
 * api.md §3.5, BR-PAY-05); quyền trên **chính booking** — khách chỉ đọc của mình (người khác ⇒ `404`),
 * nhân viên cần `payments.online` và đúng cơ sở. Lệnh thuần đọc nên **không** đi qua idempotency.
 */
import { expect, test } from 'vitest';
import { paymentSchema, paymentStatusViewSchema } from '@pinehill/contracts';
import type { PaymentStatusView } from '@pinehill/contracts';
import {
  createBooking,
  otherGuestToken,
  onlineBody,
  onlineRequest,
  rows,
  staffToken,
  statusRequest,
} from './fixture.js';
import { codeOf, nextKey, paymentRow } from './shared.js';

/** Tạo một lần khởi tạo hợp lệ để có paymentId thật (đi qua cùng đường sản phẩm của ticket). */
async function started() {
  const { booking } = await createBooking({ fullName: 'HB-094 Guest', phone: '0900000094' });
  const response = await onlineRequest(onlineBody(booking.id, { amount: booking.depositAmount }), {
    key: nextKey(),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return paymentSchema.parse(response.body);
}

const notFoundPaymentId = '9d1d0b1e-52fa-47ee-a2ef-e0c11853b70f';

test('AC3: chủ booking đọc lại bằng lệnh GET thuần — không chạm `idempotency_keys`', async () => {
  const payment = await started();
  const response = await statusRequest(payment.paymentId);
  expect(response.status).toBe(200);
  const view = paymentStatusViewSchema.parse(response.body);
  expect(view).toMatchObject({
    paymentId: payment.paymentId,
    bookingId: payment.bookingId,
    status: 'PENDING',
    amount: payment.amount,
    providerTxnId: null,
    paidAt: null,
  });
  expect(response.headers['idempotency-replayed']).toBeUndefined();
  // Lệnh GET không đi qua interceptor idempotency: không claim/khóa nào cho đường dẫn status.
  expect(
    await rows('SELECT 1 FROM idempotency_keys WHERE path=$1', ['payments/:paymentId/status']),
  ).toEqual([]);
});

test('AC3/BR-PAY-02: payment của booking khác khách ⇒ 404, không phơi tài nguyên người khác', async () => {
  const payment = await started();
  const response = await statusRequest(payment.paymentId, otherGuestToken);
  expect(response.status).toBe(404);
  expect(codeOf(response.body)).toBe('E_GEN_NOT_FOUND');
});

test('AC3: payment chưa tồn tại ⇒ 404 hằng số, không đoán trạng thái', async () => {
  const response = await statusRequest(notFoundPaymentId);
  expect(response.status).toBe(404);
  expect(codeOf(response.body)).toBe('E_GEN_NOT_FOUND');
});

test('AC3: paymentId sai định dạng (không UUID) trả 400 trước khi chạm CSDL', async () => {
  const response = await statusRequest('not-a-uuid');
  expect(response.status).toBe(400);
  expect(codeOf(response.body)).toBe('E_GEN_VALIDATION_FAILED');
});

test('AC3: thiếu Bearer ⇒ 401; ACCOUNTANT/HOUSEKEEPING/SYSADMIN không vào được 403', async () => {
  const payment = await started();
  expect((await statusRequest(payment.paymentId, null)).status).toBe(401);
  for (const role of ['ACCOUNTANT', 'HOUSEKEEPING', 'SYSADMIN'] as const) {
    const response = await statusRequest(payment.paymentId, await staffToken(role));
    expect(response.status, role).toBe(403);
    expect(codeOf(response.body)).toBe('E_RBAC_FORBIDDEN');
  }
});

test('AC3: nhân viên FRONT_DESK trong phạm vi đọc được, đúng hình Contract đã phát hành', async () => {
  const payment = await started();
  const response = await statusRequest(payment.paymentId, await staffToken('FRONT_DESK'));
  expect(response.status).toBe(200);
  const row = await paymentRow(payment.paymentId);
  const view: PaymentStatusView = paymentStatusViewSchema.parse(response.body);
  expect(view.status).toBe(row.status);
  expect(view.paidAt).toBeNull();
  expect(view.providerTxnId).toBeNull();
});
