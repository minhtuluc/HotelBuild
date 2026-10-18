/** HB-099 — ca tích hợp thật: maker–checker, ngưỡng, hạn mức PENDING, trả hạn mức, TC-PAY-23, PIN. */
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test } from 'vitest';
import { refundDecisionSchema, refundRequestSchema } from '@pinehill/contracts';
import {
  booking,
  errorCode,
  flexPolicy,
  heldAmount,
  http,
  login,
  pinToken,
  refundRequests,
  rows,
  unallocatedPayment,
} from './fixture.js';

const million = 1_000_000;
const SECOND = 'h029-second';
const key = () => randomUUID();
/** Phản hồi duyệt đúng hợp đồng `RefundDecision`: trả khoảng thời gian tới hạn chi. */
const payoutOf = (response: { body: unknown }) => {
  const decision = refundDecisionSchema.parse(response.body);
  return Date.parse(decision.payoutDeadline) - Date.parse(decision.decidedAt);
};
/** Đọc hồ sơ hoàn qua schema hợp đồng: `.body` có kiểu thật cho mọi assertion. */
const refund = (response: { body: unknown }) => refundRequestSchema.parse(response.body);

/** Bậc duy nhất ở mốc ≥7 ngày quyết định `refundPercent` của mọi hồ sơ trong file này. */
async function setTier(percent: number): Promise<void> {
  const policy = String(
    (await rows("SELECT cancellation_policy_id AS id FROM rate_plans WHERE code='FLEX7'"))[0]!.id,
  );
  await rows(
    'UPDATE cancellation_tiers SET refund_percent=$2 WHERE policy_id=$1::uuid AND offset_hours=168',
    [policy, percent],
  );
}

/** Mỗi ca tự chốt bậc 100 %: bậc huỷ nằm trong DB chung của file nên không để rò giữa các ca. */
beforeEach(async () => {
  await flexPolicy();
  await setTier(100);
});

/** Booking CONFIRMED + chứng từ **chưa phân bổ** vào nghĩa vụ: đủ quỹ để giữ hạn mức hoàn. */
async function source(amount = 2 * million) {
  const created = await booking({ status: 'CONFIRMED', price: amount, nights: 3 });
  const payment = await unallocatedPayment(created.id, BigInt(amount));
  return { bookingId: created.id, paymentId: payment, amount: BigInt(amount) };
}

/** Lập hồ sơ hoàn; mọi lệnh ghi đều bắt buộc `Idempotency-Key` (api.md §1.3). */
const openRefund = (token: string, body: object) =>
  http()
    .post('/api/v1/refund-requests')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key())
    .send(body);

const approve = (token: string, id: string, body: object) =>
  http()
    .post(`/api/v1/refund-requests/${id}/approve`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key())
    .send(body);

const reject = (token: string, id: string, body: object) =>
  http()
    .post(`/api/v1/refund-requests/${id}/reject`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key())
    .send(body);

const withdraw = (token: string, id: string, body: object) =>
  http()
    .post(`/api/v1/refund-requests/${id}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key())
    .send(body);

const guestRequest = { reason: 'GUEST_REQUEST', isForceMajeure: false };

test('cấm tự duyệt ở mọi mức: người lập leo MANAGER/OWNER vẫn bị E_PAY_SELF_APPROVAL', async () => {
  const { bookingId, paymentId } = await source();
  const maker = await login('h029-first', 'FRONT_DESK');
  const created = await openRefund(maker, { bookingId, paymentId, ...guestRequest });
  expect(created.status).toBe(201);
  const id = refund(created).id;
  for (const role of ['MANAGER', 'OWNER'] as const) {
    const token = await login('h029-first', role);
    const pin = await pinToken(token, bookingId);
    const refused = await approve(token, id, {
      approvedAmount: refund(created).requestedAmount,
      pinToken: pin,
    });
    expect(refused.status).toBe(403);
    expect(errorCode(refused.body)).toBe('E_PAY_SELF_APPROVAL');
  }
  expect(await refundRequests(bookingId)).toHaveLength(1);
  expect(await heldAmount(bookingId)).toBe(String(refund(created).netRefund));
});

test('người khác duyệt: APPROVED + auditLogId + payoutDeadline, giữ hạn mức bằng NET', async () => {
  const { bookingId, paymentId } = await source();
  const maker = await login('h029-first', 'FRONT_DESK');
  const created = await openRefund(maker, { bookingId, paymentId, ...guestRequest });
  expect(created.status).toBe(201);
  const view = refund(created);
  const checker = await login(SECOND, 'MANAGER');
  const pin = await pinToken(checker, bookingId);
  const ok = await approve(checker, view.id, {
    approvedAmount: view.requestedAmount,
    pinToken: pin,
    note: 'Duyệt đúng bậc',
  });
  expect(ok.status).toBe(200);
  const decision = refundDecisionSchema.parse(ok.body);
  expect(decision.status).toBe('APPROVED');
  expect(payoutOf(ok)).toBe(7 * 86_400_000);
  expect(await heldAmount(bookingId)).toBe(String(view.netRefund));
  expect((await refundRequests(bookingId))[0]).toMatchObject({
    status: 'APPROVED',
    approved_amount: String(view.requestedAmount),
  });
});

test('approve đòi pinToken đúng người và đúng booking; token đã tiêu thụ không dùng lại được', async () => {
  const { bookingId, paymentId } = await source();
  const maker = await login('h029-first', 'FRONT_DESK');
  const created = await openRefund(maker, { bookingId, paymentId, ...guestRequest });
  const view = refund(created);
  const checker = await login(SECOND, 'MANAGER');
  const otherBooking = (await booking({ status: 'CONFIRMED', price: million })).id;
  const foreign = await pinToken(checker, otherBooking);
  const wrongBooking = await approve(checker, view.id, {
    approvedAmount: view.requestedAmount,
    pinToken: foreign,
  });
  expect(wrongBooking.status).toBe(401);
  expect(errorCode(wrongBooking.body)).toBe('E_AUTH_PIN_REQUIRED');
  const missing = await approve(checker, view.id, { approvedAmount: view.requestedAmount });
  expect(errorCode(missing.body)).toBe('E_AUTH_PIN_REQUIRED');
  const pin = await pinToken(checker, bookingId);
  const ok = await approve(checker, view.id, {
    approvedAmount: view.requestedAmount,
    pinToken: pin,
  });
  expect(ok.status).toBe(200);
  const reused = await approve(checker, view.id, {
    approvedAmount: view.requestedAmount,
    pinToken: pin,
  });
  expect(errorCode(reused.body)).toBe('E_PAY_REFUND_NOT_PENDING');
});

test('TC-PAY-23: hai hồ sơ 80 % cùng nguồn — chỉ một giữ được hạn mức', async () => {
  await setTier(80);
  const { bookingId, paymentId } = await source(7 * million);
  const maker = await login('h029-first', 'FRONT_DESK');
  const first = await openRefund(maker, { bookingId, paymentId, ...guestRequest });
  expect(first.status).toBe(201);
  const held = refund(first);
  expect(held.refundPercent).toBe(80);
  expect(held.requiresThresholdControl).toBe(true);
  expect(await heldAmount(bookingId)).toBe(String(held.netRefund));
  const second = await openRefund(maker, { bookingId, paymentId, ...guestRequest });
  expect(second.status).toBe(422);
  expect(errorCode(second.body)).toBe('E_PAY_REFUND_EXCEEDS_PAID');
  expect(await refundRequests(bookingId)).toHaveLength(1);
  expect(await heldAmount(bookingId)).toBe(String(held.netRefund));
});

test('rút và từ chối hồ sơ PENDING đều trả hạn mức; duyệt 0 đồng bị chặn', async () => {
  const { bookingId, paymentId } = await source();
  const maker = await login('h029-first', 'FRONT_DESK');
  const created = await openRefund(maker, { bookingId, paymentId, ...guestRequest });
  const view = refund(created);
  expect(await heldAmount(bookingId)).toBe(String(view.netRefund));
  // Người lập rút được hồ sơ PENDING (BR-CANCEL-18) và hạn mức nhả ngay trong cùng transaction.
  const cancelled = await withdraw(maker, view.id, { reason: 'Khách đổi ý' });
  expect(cancelled.status).toBe(200);
  expect(refund(cancelled).status).toBe('CANCELLED');
  expect(await heldAmount(bookingId)).toBe('0');
  const again = await openRefund(maker, { bookingId, paymentId, ...guestRequest });
  expect(again.status).toBe(201);
  const next = refund(again);
  const checker = await login(SECOND, 'MANAGER');
  const pin = await pinToken(checker, bookingId);
  const zero = await approve(checker, next.id, { approvedAmount: 0, pinToken: pin });
  expect(zero.status).toBe(422);
  expect(errorCode(zero.body)).toBe('E_PAY_AMOUNT_MISMATCH');
  const refused = await reject(checker, next.id, { note: 'Không đủ căn cứ', pinToken: pin });
  expect(refused.status).toBe(200);
  expect(refund(refused).status).toBe('REJECTED');
  expect(await heldAmount(bookingId)).toBe('0');
});

test('NET toàn sự kiện trên 5 triệu cần MANAGER+; cờ ngưỡng do server quyết', async () => {
  const { bookingId, paymentId } = await source(6 * million);
  const maker = await login('h029-first', 'FRONT_DESK');
  const created = await openRefund(maker, { bookingId, paymentId, ...guestRequest });
  expect(created.status).toBe(201);
  const view = refund(created);
  expect(view.requestedAmount).toBe(6 * million);
  expect(view.eventNetRefund).toBe(view.netRefund);
  expect(view.requiresThresholdControl).toBe(true);
  const frontDesk = await login('h029-first', 'FRONT_DESK');
  const denied = await approve(frontDesk, view.id, { approvedAmount: view.requestedAmount });
  expect(denied.status).toBe(403);
  expect(errorCode(denied.body)).toBe('E_RBAC_FORBIDDEN');
  const checker = await login(SECOND, 'MANAGER');
  const pin = await pinToken(checker, bookingId);
  const ok = await approve(checker, view.id, {
    approvedAmount: view.requestedAmount,
    pinToken: pin,
    note: 'Duyệt trên ngưỡng',
  });
  expect(ok.status).toBe(200);
  expect(refundDecisionSchema.parse(ok.body).status).toBe('APPROVED');
});
