/**
 * HB-100 — ca tích hợp thật cho chi hoàn (PostgreSQL16 + Redis15):
 * quyền/PIN/phương thức gốc, operation bền, worker chốt PAID, timeout giữ hạn mức, và ca bắt buộc
 * **PSP đã chi rồi transaction nghiệp vụ bị huỷ** ⇒ lần chạy lại không tạo khoản chi thứ hai.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { claimPayouts } from '../../../../apps/worker/src/jobs/refund-payout/claim.js';
import {
  settlePayout,
  StalePayoutLease,
} from '../../../../apps/worker/src/jobs/refund-payout/settle.js';
import type { PayoutGateway } from '../../../../apps/worker/src/jobs/refund-payout/types.js';
import {
  approvedRefund,
  cashierFor,
  db,
  errorCode,
  heldAmount,
  login,
  openRefund,
  operations,
  pay,
  propertyId,
  refundPayments,
  refundRow,
  rows,
  runPayoutJob,
  simulatorTransfers,
} from './fixture.js';

const vnpay = { method: 'VNPAY' } as const;
/** Hợp đồng trả về của lệnh chi: chỉ đọc các trường test cần, parse ở biên thay vì cast. */
const payoutBody = z.object({
  operations: z.array(z.object({ id: z.string(), status: z.string(), amount: z.number().int() })),
});
const bookingRefunded = async (id: string) =>
  String(
    (await rows('SELECT refunded_amount FROM bookings WHERE id=$1::uuid', [id]))[0]!
      .refunded_amount,
  );

/** Dựng hồ sơ đã APPROVED + chứng từ chi PENDING (lệnh HTTP thật của kế toán). */
async function prepared() {
  const refund = await approvedRefund();
  const cashier = await cashierFor(refund.bookingId);
  const response = await pay(cashier.token, refund.refundId, { ...vnpay, pinToken: cashier.pin });
  expect(response.status).toBe(202);
  return { ...refund, ...cashier };
}

test('kế toán tạo chứng từ chi PENDING đúng một lần; trạng thái hồ sơ vẫn APPROVED', async () => {
  const refund = await approvedRefund();
  const cashier = await cashierFor(refund.bookingId);
  const missingPin = await pay(cashier.token, refund.refundId, vnpay);
  expect(missingPin.status).toBe(401);
  expect(errorCode(missingPin.body)).toBe('E_AUTH_PIN_REQUIRED');
  const wrongMethod = await pay(cashier.token, refund.refundId, {
    method: 'MOMO',
    pinToken: cashier.pin,
  });
  expect(wrongMethod.status).toBe(400);
  const frontDesk = await login('h100-maker', 'FRONT_DESK');
  const forbidden = await pay(frontDesk, refund.refundId, { ...vnpay, pinToken: cashier.pin });
  expect(forbidden.status).toBe(403);

  const created = await pay(cashier.token, refund.refundId, { ...vnpay, pinToken: cashier.pin });
  expect(created.status).toBe(202);
  const body = payoutBody.parse(created.body);
  expect(body.operations).toHaveLength(1);
  expect(body.operations[0]).toMatchObject({ status: 'READY', amount: refund.netRefund });
  expect((await refundRow(refund.refundId)).status).toBe('APPROVED');
  expect(await heldAmount(refund.bookingId)).toBe(String(refund.netRefund));
  expect(await bookingRefunded(refund.bookingId)).toBe('0');
  const payments = await refundPayments(refund.bookingId);
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({
    status: 'PENDING',
    method: 'VNPAY',
    amount: String(-refund.netRefund),
  });

  // Khoá chống trùng khác vẫn không sinh leg/khoá PSP thứ hai (UNIQUE request+receipt là hàng rào cuối).
  const freshPin = await cashierFor(refund.bookingId);
  const duplicate = await pay(freshPin.token, refund.refundId, {
    ...vnpay,
    pinToken: freshPin.pin,
  });
  expect(duplicate.status).toBe(202);
  expect(payoutBody.parse(duplicate.body).operations[0]!.id).toBe(body.operations[0]!.id);
  expect(await operations(refund.refundId)).toHaveLength(1);
  expect(await refundPayments(refund.bookingId)).toHaveLength(1);
});

test('chỉ chi hồ sơ APPROVED; hồ sơ PENDING trả 409', async () => {
  const pending = await openRefund();
  const cashier = await cashierFor(pending.bookingId);
  const refused = await pay(cashier.token, pending.refundId, { ...vnpay, pinToken: cashier.pin });
  expect(refused.status).toBe(409);
  expect(errorCode(refused.body)).toBe('E_PAY_REFUND_NOT_APPROVED');
  expect(await operations(pending.refundId)).toHaveLength(0);
});

test('tiền mặt hoàn bằng chuyển khoản: bắt buộc bankNote; worker chờ đối soát tay, giữ hạn mức', async () => {
  const refund = await approvedRefund(2_000_000, 'CASH');
  const cashier = await cashierFor(refund.bookingId);
  const wrongMethod = await pay(cashier.token, refund.refundId, {
    method: 'VNPAY',
    pinToken: cashier.pin,
  });
  expect(wrongMethod.status).toBe(400);
  const noNote = await pay(cashier.token, refund.refundId, {
    method: 'BANK_TRANSFER',
    pinToken: cashier.pin,
  });
  expect(noNote.status).toBe(400);
  const created = await pay(cashier.token, refund.refundId, {
    method: 'BANK_TRANSFER',
    bankNote: 'STK 0123456789 — NGUYEN VAN A',
    pinToken: cashier.pin,
  });
  expect(created.status).toBe(202);
  expect((await refundPayments(refund.bookingId))[0]).toMatchObject({
    method: 'BANK_TRANSFER',
    note: 'STK 0123456789 — NGUYEN VAN A',
  });

  await runPayoutJob();
  const [operation] = await operations(refund.refundId);
  expect(operation).toMatchObject({
    status: 'UNKNOWN',
    last_error: 'MANUAL_TRANSFER_AWAITING_CONFIRMATION',
    method: 'BANK_TRANSFER',
  });
  expect((await refundRow(refund.refundId)).status).toBe('APPROVED');
  expect(await heldAmount(refund.bookingId)).toBe(String(refund.netRefund));
  expect(await simulatorTransfers()).toHaveLength(0);
});

test('worker chi thành công: PAID, chứng từ SUCCEEDED, sổ booking và audit/outbox cùng transaction', async () => {
  const refund = await prepared();
  await runPayoutJob();

  const [payment] = await refundPayments(refund.bookingId);
  expect(payment).toMatchObject({ status: 'SUCCEEDED', method: 'VNPAY' });
  expect(String(payment!.provider_txn_id)).toMatch(/^SIM-/);
  expect((await refundRow(refund.refundId)).status).toBe('PAID');
  expect(await bookingRefunded(refund.bookingId)).toBe(String(refund.netRefund));
  const transfers = await simulatorTransfers();
  expect(transfers).toHaveLength(1);
  expect(transfers[0]).toMatchObject({ amount: String(refund.netRefund), status: 'SUCCEEDED' });
  expect(String(transfers[0]!.provider_txn_id)).toBe(String(payment!.provider_txn_id));
  expect(
    await rows(
      "SELECT id FROM audit_logs WHERE entity_id=$1::uuid AND action='REFUND_PAYOUT_SETTLED'",
      [refund.refundId],
    ),
  ).toHaveLength(1);
  expect(
    await rows(
      "SELECT id FROM outbox_events WHERE aggregate_id=$1::uuid AND event_type='RefundPaid'",
      [refund.refundId],
    ),
  ).toHaveLength(1);

  // Lượt quét sau không gửi lần hai.
  await runPayoutJob();
  expect(await simulatorTransfers()).toHaveLength(1);
  expect(await refundPayments(refund.bookingId)).toHaveLength(1);
});

test('timeout: operation UNKNOWN, giữ hạn mức và đúng khoá PSP; lượt sau đối soát rồi mới gửi lại', async () => {
  const refund = await prepared();
  const [before] = await operations(refund.refundId);
  const timeout: PayoutGateway = {
    automatic: true,
    query: async () => ({ state: 'NOT_FOUND' }),
    submit: async () => {
      throw new Error('synthetic gateway timeout');
    },
  };
  await runPayoutJob({ gateway: () => timeout });

  const [parked] = await operations(refund.refundId);
  expect(parked).toMatchObject({
    status: 'UNKNOWN',
    last_error: 'PROVIDER_TIMEOUT',
    psp_key: before!.psp_key,
    attempts: 1,
  });
  expect((await refundRow(refund.refundId)).status).toBe('APPROVED');
  expect(await heldAmount(refund.bookingId)).toBe(String(refund.netRefund));
  expect(await simulatorTransfers()).toHaveLength(0);
  expect((await refundPayments(refund.bookingId))[0]!.status).toBe('PENDING');

  // Hết hạn chờ đối soát ⇒ lượt sau `query` (NOT_FOUND) rồi gửi lại **cùng** khoá.
  await rows(
    "UPDATE refund_payout_operations SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE refund_request_id=$1::uuid",
    [refund.refundId],
  );
  await runPayoutJob();
  const transfers = await simulatorTransfers();
  expect(transfers).toHaveLength(1);
  const [settled] = await operations(refund.refundId);
  expect(settled).toMatchObject({ status: 'SUCCEEDED', psp_key: before!.psp_key, attempts: 2 });
  expect((await refundRow(refund.refundId)).status).toBe('PAID');
});

test('CRASH: PSP đã chi, transaction chốt bị huỷ ⇒ chạy lại không tạo khoản chi thứ hai và kết thúc PAID', async () => {
  const refund = await prepared();
  // Chặn đúng câu chốt SUCCEEDED của worker bằng một trigger CSDL thật ⇒ transaction nghiệp vụ abort,
  // còn giao dịch mô phỏng PSP đã ghi bằng kết nối riêng (đúng "PSP thành công trước commit").
  await rows(`
    CREATE OR REPLACE FUNCTION hb100_crash() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.status = 'SUCCEEDED' THEN
        RAISE EXCEPTION 'HB100 synthetic crash before commit';
      END IF;
      RETURN NEW;
    END $$`);
  await rows(`
    CREATE TRIGGER hb100_crash BEFORE UPDATE ON refund_payout_operations
      FOR EACH ROW EXECUTE FUNCTION hb100_crash()`);
  try {
    await expect(runPayoutJob()).rejects.toThrow('REFUND_PAYOUT_FAILED');
  } finally {
    await rows('DROP TRIGGER hb100_crash ON refund_payout_operations');
    await rows('DROP FUNCTION hb100_crash()');
  }

  const crashed = await simulatorTransfers();
  expect(crashed).toHaveLength(1);
  const [inflight] = await operations(refund.refundId);
  expect(inflight).toMatchObject({ status: 'IN_FLIGHT', attempts: 1 });
  expect((await refundRow(refund.refundId)).status).toBe('APPROVED');
  expect((await refundPayments(refund.bookingId))[0]!.status).toBe('PENDING');
  expect(await bookingRefunded(refund.bookingId)).toBe('0');
  expect(await heldAmount(refund.bookingId)).toBe(String(refund.netRefund));

  // Worker chết để lại lease; hết lease, lượt sau đối soát bằng khoá bền và chốt PAID.
  await rows(
    "UPDATE refund_payout_operations SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE refund_request_id=$1::uuid",
    [refund.refundId],
  );
  await runPayoutJob();

  expect(await simulatorTransfers()).toHaveLength(1);
  expect(await refundPayments(refund.bookingId)).toHaveLength(1);
  const [settled] = await operations(refund.refundId);
  expect(settled).toMatchObject({
    status: 'SUCCEEDED',
    attempts: 1,
    psp_key: inflight!.psp_key,
    provider_txn_id: crashed[0]!.provider_txn_id,
  });
  expect((await refundRow(refund.refundId)).status).toBe('PAID');
  expect(await bookingRefunded(refund.bookingId)).toBe(String(refund.netRefund));
});

test('worker mất lease không commit được kết quả (version/lease fencing)', async () => {
  const refund = await prepared();
  const [claimed] = await claimPayouts(db, 10, 60);
  expect(claimed?.refundRequestId).toBe(refund.refundId);
  // Một worker khác nhận việc: lease mới + version mới.
  await rows(
    "UPDATE refund_payout_operations SET lease_token=gen_random_uuid(), lease_expires_at=clock_timestamp()+interval '60 seconds' WHERE id=$1::uuid",
    [claimed!.id],
  );
  await expect(
    settlePayout(db, claimed!, { providerTxnId: 'SIM-STALE-WORKER' }),
  ).rejects.toBeInstanceOf(StalePayoutLease);
  expect((await refundPayments(refund.bookingId))[0]!.status).toBe('PENDING');
  expect((await refundRow(refund.refundId)).status).toBe('APPROVED');
  expect((await operations(refund.refundId))[0]!.status).toBe('IN_FLIGHT');
});

test('idempotency replay cùng khoá trả lại kết quả đã commit, không tiêu PIN lần hai', async () => {
  const refund = await approvedRefund();
  const cashier = await cashierFor(refund.bookingId);
  const key = randomUUID();
  const first = await pay(cashier.token, refund.refundId, { ...vnpay, pinToken: cashier.pin }, key);
  expect(first.status).toBe(202);
  const replay = await pay(
    cashier.token,
    refund.refundId,
    { ...vnpay, pinToken: cashier.pin },
    key,
  );
  expect(replay.status).toBe(202);
  expect(replay.body).toEqual(first.body);
  expect(await operations(refund.refundId)).toHaveLength(1);
});

test('hồ sơ ngoài phạm vi cơ sở bị chặn trước khi tạo chứng từ', async () => {
  const refund = await approvedRefund();
  const cashier = await cashierFor(refund.bookingId);
  // Bỏ scope cơ sở sau khi đã có phiên + PIN: service kiểm lại bằng CSDL, không tin token cũ.
  await rows(
    "DELETE FROM user_property_scopes WHERE user_id=(SELECT id FROM users WHERE username='h100-cashier')",
  );
  try {
    const refused = await pay(cashier.token, refund.refundId, {
      ...vnpay,
      pinToken: cashier.pin,
    });
    expect(refused.status).toBe(403);
    expect(errorCode(refused.body)).toBe('E_RBAC_FORBIDDEN');
    expect(await operations(refund.refundId)).toHaveLength(0);
  } finally {
    await rows(
      `INSERT INTO user_property_scopes(user_id,property_id)
       SELECT id, $1::uuid FROM users WHERE username='h100-cashier' ON CONFLICT DO NOTHING`,
      [propertyId],
    );
  }
});
