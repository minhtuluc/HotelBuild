/**
 * HB-095 — webhook PSP trên app thật + PostgreSQL 16 + Redis (DB `/7`).
 *
 * Mỗi chốt ticket một ca:
 * - TN-1: chữ ký đúng ⇒ ACK đúng cổng (VNPay `RspCode` JSON, MoMo HTTP 204 thân rỗng), ghi inbox +
 *   tiền + phân bổ + audit trong cùng transaction.
 * - TN-2: verify sai ⇒ từ chối, **không** ghi inbox/payment/audit (verify trước dedup).
 * - TN-3: 5 callback trùng ⇒ **1** Payment SUCCEEDED, 1 hàng inbox, ACK lặp lại mã cũ (TC-PAY-22).
 * - TN-4: SUCCEEDED sau FAILED (timeout cục bộ) ⇒ tiền ghi; decline muộn không hạ; booking giữ trạng thái.
 * - TN-5: tiền vào hold hết hiệu lực ⇒ nghĩa vụ hoàn 100% (`PAYMENT_TIMEOUT`, SYSTEM), không phân bổ.
 * - TN-6: lỗi CSDL khi ghi inbox ⇒ `RspCode 99` / HTTP 500 (không success-ACK); PSP gửi lại nhận đủ.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import request from 'supertest';

import {
  MERCHANT_CODE,
  auditOf,
  bookingStatus,
  callbackUrl,
  count,
  createBooking,
  createMockModeApp,
  http,
  initiateOnlineDeposit,
  paidRow,
  pspSimulator,
  rows,
  clock,
} from './fixture.js';
import type { AuditRow } from './fixture.js';
import { TableOutage } from './db-fault.js';
import type { SimulatedEvent } from '../../src/modules/pay/psp/simulator.js';

const VNPAY_APPLIED = { RspCode: '00', Message: 'Confirm Success' };
const VNPAY_DUPLICATE = { RspCode: '02', Message: 'Order already confirmed' };

/** Callback mẫu: booking + Payment tạo **qua đường sản phẩm**, sự kiện do simulator ký cùng cấu hình. */
async function paidCallback(method: 'vnpay' | 'momo'): Promise<{
  bookingId: string;
  paymentId: string;
  event: SimulatedEvent;
}> {
  const booking = await createBooking({ fullName: 'HB-095 Guest', phone: '0900000095' });
  const payment = await initiateOnlineDeposit(booking, {
    method: method === 'vnpay' ? 'VNPAY' : 'MOMO',
  });
  // `orderRef` ta phát hành lúc `init` nằm ngay trong URL đã ký của cổng (BR-PAY-03 đối chiếu bằng nó).
  const params = new URL(payment.paymentUrl!).searchParams;
  const event: SimulatedEvent = {
    method: method === 'vnpay' ? 'VNPAY' : 'MOMO',
    orderRef: params.get('vnp_TxnRef') ?? params.get('orderId') ?? payment.paymentId,
    amount: BigInt(payment.amount),
    outcome: 'SUCCEEDED',
    providerTxnId: `TXN-${randomUUID()}`,
    at: clock.now(),
  };
  return { bookingId: booking.id, paymentId: payment.paymentId, event };
}

/** Audit ngoài `PAYMENT_ONLINE_INITIATED` (HB-094) — mỗi sự kiện webhook phải có đúng một dòng. */
function webhookActions(audit: AuditRow[]): string[] {
  return audit.filter((row) => row.action !== 'PAYMENT_ONLINE_INITIATED').map((row) => row.action);
}

const CARD_KEYS = ['cardnumber', 'cardholder', 'cvv', 'expirydate', 'securitycode'] as const;

/** BR-PAY-04: snapshot audit không có khoá dữ liệu thẻ và không có chuỗi giống số thẻ 16 chữ số. */
function expectNoCardData(audit: AuditRow[]): void {
  const serialized = JSON.stringify(audit).toLowerCase();
  for (const key of CARD_KEYS) expect(serialized).not.toContain(key);
  expect(/\d{15,19}/.test(serialized)).toBe(false);
}

/** Số tiền đã phân bổ còn hiệu lực của một khoản thu (như sổ cái HB-093 đọc). */
async function allocated(paymentId: string): Promise<bigint> {
  const total = (
    await rows(
      `SELECT coalesce(sum(amount - released_amount), 0)::text AS total
         FROM payment_allocations WHERE payment_id=$1::uuid`,
      [paymentId],
    )
  )[0]?.total;
  return BigInt(String(total ?? '0'));
}

test('TN-1/VNPay: chữ ký đúng ⇒ `RspCode 00`, 1 hàng inbox, Payment SUCCEEDED + phân bổ + audit', async () => {
  const { bookingId, paymentId, event } = await paidCallback('vnpay');
  const response = await http().get(callbackUrl('vnpay')).query(pspSimulator().event(event));
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body).toEqual(VNPAY_APPLIED);
  const paid = await paidRow(paymentId);
  expect(paid).toMatchObject({
    status: 'SUCCEEDED',
    provider_txn_id: event.providerTxnId,
    amount: String(event.amount),
  });
  expect(paid.paid_at).not.toBeNull();
  expect(
    await rows(
      'SELECT provider,provider_account_id,status,attempts FROM webhook_inbox WHERE event_id=$1',
      [event.providerTxnId],
    ),
  ).toEqual([
    { provider: 'VNPAY', provider_account_id: MERCHANT_CODE, status: 'PROCESSED', attempts: 1 },
  ]);
  expect(await allocated(paymentId)).toBe(event.amount);
  expect(webhookActions(await auditOf(paymentId))).toEqual(['PAYMENT_APPLIED']);
  // "Audit mỗi sự kiện": vết của sự kiện mang đúng `event_id` của hàng inbox + provider + trạng thái.
  const [lastAudit] = (await auditOf(paymentId)).slice(-1);
  expect(lastAudit?.after_json).toMatchObject({
    provider: 'VNPAY',
    eventId: event.providerTxnId,
    outcome: 'SUCCEEDED',
    status: 'SUCCEEDED',
  });
  expect(await bookingStatus(bookingId)).toBe('HELD');
  expectNoCardData(await auditOf(paymentId));
});

test('TN-1/MoMo: HTTP 204 thân rỗng, cùng chuỗi ghi bền như VNPay', async () => {
  const { paymentId, event } = await paidCallback('momo');
  const response = await http()
    .post(callbackUrl('momo'))
    .set('content-type', 'application/json')
    .send(pspSimulator().event(event));
  expect(response.status, JSON.stringify(response.body)).toBe(204);
  expect(response.text).toBe('');
  expect(await paidRow(paymentId)).toMatchObject({
    status: 'SUCCEEDED',
    provider_txn_id: event.providerTxnId,
  });
  expect(await count('SELECT 1 FROM webhook_inbox WHERE event_id=$1', [event.providerTxnId])).toBe(
    1,
  );
});

test('TN-2: chữ ký sai ⇒ `RspCode 97`, không inbox, không đụng payment/audit (verify trước dedup)', async () => {
  const { bookingId, paymentId, event } = await paidCallback('vnpay');
  const tampered = pspSimulator().event(event).replace('vnp_Amount', 'vnp_Amount2');
  const response = await http().get(callbackUrl('vnpay')).query(tampered);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body).toEqual({ RspCode: '97', Message: 'Invalid signature' });
  expect(await count('SELECT 1 FROM webhook_inbox WHERE event_id=$1', [event.providerTxnId])).toBe(
    0,
  );
  expect(await paidRow(paymentId)).toMatchObject({ status: 'PENDING', provider_txn_id: null });
  expect(webhookActions(await auditOf(paymentId))).toEqual([]);
  expect(await bookingStatus(bookingId)).toBe('HELD');
});

test('TN-2/MoMo: thân JSON thiếu trường giao thức ⇒ 400, không ghi inbox', async () => {
  const { paymentId, event } = await paidCallback('momo');
  const broken = pspSimulator().event(event).replace('resultCode', 'resultCoee');
  const response = await http()
    .post(callbackUrl('momo'))
    .set('content-type', 'application/json')
    .send(broken);
  expect(response.status, JSON.stringify(response.body)).toBe(400);
  expect(await count('SELECT 1 FROM webhook_inbox WHERE event_id=$1', [event.providerTxnId])).toBe(
    0,
  );
  expect(await paidRow(paymentId)).toMatchObject({ status: 'PENDING' });
});

test('TN-3/TC-PAY-22: 5 callback trùng ⇒ 1 Payment, 1 inbox, tiền cộng đúng một lần', async () => {
  const { bookingId, paymentId, event } = await paidCallback('vnpay');
  const same = pspSimulator().event({ ...event, providerTxnId: 'TXN-SAME' });
  const acks: { status: number; body: unknown }[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await http().get(callbackUrl('vnpay')).query(same);
    acks.push({ status: response.status, body: response.body });
  }
  expect(acks[0]).toEqual({ status: 200, body: VNPAY_APPLIED });
  expect(acks.slice(1)).toEqual(
    Array.from({ length: 4 }, () => ({ status: 200, body: VNPAY_DUPLICATE })),
  );
  expect(await paidRow(paymentId)).toMatchObject({
    status: 'SUCCEEDED',
    provider_txn_id: 'TXN-SAME',
    amount: String(event.amount),
  });
  expect(await allocated(paymentId)).toBe(event.amount);
  expect(await count('SELECT 1 FROM webhook_inbox WHERE event_id=$1', ['TXN-SAME'])).toBe(1);
  expect(await count('SELECT 1 FROM payments WHERE id=$1::uuid', [paymentId])).toBe(1);
  // Số dư booking: thu một lần thì phần còn thiếu = tổng giá − đúng khoản đã thu (không cộng dồn).
  const [totals] = await rows(
    `SELECT b.total_amount::text AS total, b.paid_amount::text AS paid, b.balance_due::text AS due
       FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE p.id=$1::uuid`,
    [paymentId],
  );
  expect(BigInt(String(totals?.paid))).toBe(event.amount);
  expect(BigInt(String(totals?.due))).toBe(BigInt(String(totals?.total)) - event.amount);
  expect(webhookActions(await auditOf(paymentId))).toEqual(['PAYMENT_APPLIED']);
  // "Audit mỗi sự kiện": 4 bản phát lại để lại vết riêng trên hàng inbox, tiền vẫn chỉ cộng một lần.
  const [inbox] = await rows('SELECT id FROM webhook_inbox WHERE event_id=$1', ['TXN-SAME']);
  expect(
    await rows(
      `SELECT action,entity_type FROM audit_logs WHERE entity_type='WebhookInbox' AND entity_id=$1::uuid`,
      [inbox?.id],
    ),
  ).toEqual(
    Array.from({ length: 4 }, () => ({
      action: 'PAYMENT_WEBHOOK_REPLAYED',
      entity_type: 'WebhookInbox',
    })),
  );
  expect(await bookingStatus(bookingId)).toBe('HELD');
});

test('TN-4: SUCCEEDED sau FAILED ⇒ tiền ghi; decline muộn không hạ; booking giữ HELD', async () => {
  const { bookingId, paymentId, event } = await paidCallback('vnpay');
  const simulator = pspSimulator();
  // 1) Từ chối (như timeout cục bộ BR-PAY-05): Payment về FAILED, chưa có tiền, booking không đổi.
  const declined = await http()
    .get(callbackUrl('vnpay'))
    .query(
      simulator.event({ ...event, outcome: 'FAILED', providerTxnId: `${event.providerTxnId}-F` }),
    );
  expect(declined.body).toEqual(VNPAY_APPLIED);
  expect(await paidRow(paymentId)).toMatchObject({ status: 'FAILED', provider_txn_id: null });
  expect(await allocated(paymentId)).toBe(0n);
  expect(await bookingStatus(bookingId)).toBe('HELD');
  // 2) SUCCEEDED đến muộn (lượt trả lại có mã giao dịch cổng khác — BR-PAY-11): đúng một lần cộng tiền.
  const success = await http()
    .get(callbackUrl('vnpay'))
    .query(simulator.event({ ...event, providerTxnId: `${event.providerTxnId}-S` }));
  expect(success.body).toEqual(VNPAY_APPLIED);
  expect(await paidRow(paymentId)).toMatchObject({
    status: 'SUCCEEDED',
    provider_txn_id: `${event.providerTxnId}-S`,
  });
  expect(await allocated(paymentId)).toBe(event.amount);
  expect(await count('SELECT 1 FROM refund_requests WHERE booking_id=$1::uuid', [bookingId])).toBe(
    0,
  );
  expect(await bookingStatus(bookingId)).toBe('HELD');
  // 3) Từ chối khác giao dịch đến **sau**: ghi vết nhưng không hạ khoản đã thu ⇒ ACK "đã xử lý" (`02`).
  const stale = await http()
    .get(callbackUrl('vnpay'))
    .query(simulator.event({ ...event, outcome: 'FAILED', providerTxnId: `TXN-${randomUUID()}` }));
  expect(stale.body).toEqual(VNPAY_DUPLICATE);
  expect(await paidRow(paymentId)).toMatchObject({
    status: 'SUCCEEDED',
    provider_txn_id: `${event.providerTxnId}-S`,
  });
  expect(await allocated(paymentId)).toBe(event.amount);
  expect(await bookingStatus(bookingId)).toBe('HELD');
  expect(webhookActions(await auditOf(paymentId))).toEqual([
    'PAYMENT_DECLINED',
    'PAYMENT_APPLIED',
    'PAYMENT_STALE_DECLINE',
  ]);
});

test('TN-5: tiền vào hold hết hiệu lực ⇒ nghĩa vụ hoàn 100%, giữ trạng thái, không phân bổ', async () => {
  const { bookingId, paymentId, event } = await paidCallback('vnpay');
  await rows(
    `UPDATE bookings SET hold_expires_at=clock_timestamp() - interval '1 minute' WHERE id=$1::uuid`,
    [bookingId],
  );
  const response = await http().get(callbackUrl('vnpay')).query(pspSimulator().event(event));
  expect(response.body).toEqual(VNPAY_APPLIED);
  expect(await paidRow(paymentId)).toMatchObject({
    status: 'SUCCEEDED',
    provider_txn_id: event.providerTxnId,
  });
  expect(await bookingStatus(bookingId)).toBe('HELD'); // KHÔNG tự kết thúc hold: job HB-078 làm việc đó.
  expect(
    await rows(
      `SELECT reason,requester_type,requester_id,requested_amount::text AS requested,
              refund_fee::text AS fee,refund_percent::text AS percent,event_key,status
         FROM refund_requests WHERE booking_id=$1::uuid`,
      [bookingId],
    ),
  ).toEqual([
    {
      reason: 'PAYMENT_TIMEOUT',
      requester_type: 'SYSTEM',
      requester_id: 'webhook-psp',
      requested: event.amount.toString(),
      fee: '0',
      percent: '100.00',
      event_key: `psp-late:${paymentId}`,
      status: 'PENDING',
    },
  ]);
  // Tiền thu muộn **giữ cho hoàn** qua `refund_allocations`, không phân bổ vào nghĩa vụ phòng.
  expect(await allocated(paymentId)).toBe(0n);
  expect(
    await count('SELECT 1 FROM refund_allocations WHERE original_payment_id=$1::uuid', [paymentId]),
  ).toBe(1);
});

test('TN-6/VNPay: lỗi CSDL khi ghi inbox ⇒ `RspCode 99` (không success-ACK); gửi lại nhận đủ', async () => {
  const { paymentId, event } = await paidCallback('vnpay');
  const outage = await TableOutage.start('webhook_inbox', 'hb095_outage');
  try {
    const response = await http().get(callbackUrl('vnpay')).query(pspSimulator().event(event));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual({ RspCode: '99', Message: 'Unknown error' });
    expect(await paidRow(paymentId)).toMatchObject({ status: 'PENDING' });
  } finally {
    await outage.restore();
  }
  // PSP gửi lại đúng callback khi CSDL đã lành: sự kiện ghi đúng một lần và nhận tiền.
  const retry = await http().get(callbackUrl('vnpay')).query(pspSimulator().event(event));
  expect(retry.body).toEqual(VNPAY_APPLIED);
  expect(await count('SELECT 1 FROM webhook_inbox WHERE event_id=$1', [event.providerTxnId])).toBe(
    1,
  );
  expect(await paidRow(paymentId)).toMatchObject({
    status: 'SUCCEEDED',
    provider_txn_id: event.providerTxnId,
  });
});

test('TN-6/MoMo: lỗi CSDL khi ghi inbox ⇒ HTTP 500 chứ không 204', async () => {
  const { paymentId, event } = await paidCallback('momo');
  const outage = await TableOutage.start('webhook_inbox', 'hb095_outage');
  try {
    const response = await http()
      .post(callbackUrl('momo'))
      .set('content-type', 'application/json')
      .send(pspSimulator().event(event));
    expect(response.status, JSON.stringify(response.body)).toBe(500);
    expect(response.text).toContain('E_PAY_INBOX_UNAVAILABLE');
    expect(await paidRow(paymentId)).toMatchObject({ status: 'PENDING' });
  } finally {
    await outage.restore();
  }
});

test('TN-7/P0: khoá mô phỏng công khai (mode=mock) ⇒ 503 E_PSP_NOT_PRODUCTION, không ghi inbox', async () => {
  const before = await count('SELECT 1 FROM webhook_inbox');
  // App thứ hai **thiếu** khoá PSP: adapter rơi vào bộ mô phỏng công khai của `pay/psp` (mode `mock`).
  const mockApp = await createMockModeApp();
  try {
    const vnpay = await request(mockApp.getHttpServer())
      .get(callbackUrl('vnpay'))
      .query('vnp_TxnRef=x&vnp_Amount=100');
    expect(vnpay.status, JSON.stringify(vnpay.body)).toBe(503);
    expect(vnpay.body).toMatchObject({ code: 'E_PSP_NOT_PRODUCTION' });
    const momo = await request(mockApp.getHttpServer())
      .post(callbackUrl('momo'))
      .set('content-type', 'application/json')
      .send('{"orderId":"x"}');
    expect(momo.status, JSON.stringify(momo.body)).toBe(503);
    expect(momo.body).toMatchObject({ code: 'E_PSP_NOT_PRODUCTION' });
  } finally {
    await mockApp.close();
  }
  // Từ chối **trước** verify ⇒ không payload nào (kể cả payload rác) chạm tới inbox, và không có tiền.
  expect(await count('SELECT 1 FROM webhook_inbox')).toBe(before);
});

test('TN-8/F6: apply lỗi ⇒ hàng FAILED; gửi lại cùng event khác payload ⇒ lần này ÁP DỤNG, không ACK 02', async () => {
  const { paymentId, event } = await paidCallback('vnpay');
  const simulator = pspSimulator();
  const storedHashOf = async () =>
    String(
      (
        await rows('SELECT payload_hash FROM webhook_inbox WHERE event_id=$1', [
          event.providerTxnId,
        ])
      )[0]?.payload_hash,
    );
  // 1) Lần gửi đầu: áp dụng lỗi vì CSDL hỏng (`payment_allocations` biến mất) ⇒ sự kiện đã bền nhưng
  //    chưa áp dụng: hàng inbox `FAILED`, ACK mã retryable chứ không success-ACK.
  const outage = await TableOutage.start('payment_allocations', 'hb095_outage');
  let firstStatus = 0;
  let firstBody: unknown = null;
  try {
    const first = await http().get(callbackUrl('vnpay')).query(simulator.event(event));
    firstStatus = first.status;
    firstBody = first.body;
    expect(
      await rows('SELECT status,last_error FROM webhook_inbox WHERE event_id=$1', [
        event.providerTxnId,
      ]),
    ).toEqual([{ status: 'FAILED', last_error: 'APPLY_FAILED' }]);
    expect(await paidRow(paymentId)).toMatchObject({ status: 'PENDING' });
  } finally {
    await outage.restore();
  }
  // Không có tiền nào được ghi trong lượt hỏng (đọc bảng phân bổ sau khi schema lành lại).
  expect(await allocated(paymentId)).toBe(0n);
  expect(firstStatus).toBe(200);
  expect(firstBody).toEqual({ RspCode: '99', Message: 'Unknown error' });
  const storedHash = await storedHashOf();
  // 2) Cổng gửi lại **cùng `event_id`** nhưng payload khác một chút (giờ cổng ghi nhận lệch 1 phút):
  //    hàng đang FAILED là việc còn dở nên phải áp dụng lần này, không được coi là "đã xử lý".
  const replayed = await http()
    .get(callbackUrl('vnpay'))
    .query(simulator.event({ ...event, at: new Date(event.at.getTime() + 60_000) }));
  expect(replayed.status, JSON.stringify(replayed.body)).toBe(200);
  expect(replayed.body).toEqual(VNPAY_APPLIED);
  expect(await paidRow(paymentId)).toMatchObject({
    status: 'SUCCEEDED',
    provider_txn_id: event.providerTxnId,
  });
  expect(await allocated(paymentId)).toBe(event.amount);
  // 3) Payload gốc không bị ghi đè; sai khác payload để lại vết audit riêng, `last_error` của hàng
  //    không bị dùng làm nơi ghi đè (P1/F6).
  const [inboxRow] = await rows(
    'SELECT id,payload_hash,payload_json,status,last_error FROM webhook_inbox WHERE event_id=$1',
    [event.providerTxnId],
  );
  expect(inboxRow).toMatchObject({
    payload_hash: storedHash,
    status: 'PROCESSED',
    last_error: null,
  });
  expect(
    await rows(
      `SELECT action,after_json FROM audit_logs
      WHERE entity_type='WebhookInbox' AND entity_id=$1::uuid AND action='PAYMENT_WEBHOOK_PAYLOAD_MISMATCH'`,
      [inboxRow?.id],
    ),
  ).toHaveLength(1);
});
