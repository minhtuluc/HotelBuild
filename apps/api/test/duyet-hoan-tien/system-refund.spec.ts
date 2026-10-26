/**
 * HB-212 — hồ sơ hoàn do **SYSTEM** lập khi hold hết hạn mà PSP đã thu tiền (F5-QA-01) vẫn phải đi qua
 * maker–checker như mọi hồ sơ (BR-CANCEL-15, QĐ-07 mục 2): không ai tự duyệt, quầy không duyệt được,
 * trên ngưỡng phải là MANAGER/OWNER và lượt duyệt ghi đủ `refund_approvals` + `AuditLog`.
 *
 * Bản ghi SYSTEM ở đây dựng bằng SQL đúng hình dạng `apps/worker/src/jobs/hold-expiry/refund.ts` để lại
 * (`event_key = 'hold-expiry'`, `requester_type = 'SYSTEM'`, `requested_by = NULL`,
 * `reason = 'PAYMENT_TIMEOUT'`, `refund_percent = 100`, `refund_fee = 0`) — nhánh HB-213 (`GET`) chưa có
 * trên nhánh này nên không đọc lại được qua HTTP.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { refundDecisionSchema } from '@pinehill/contracts';
import {
  booking,
  errorCode,
  heldAmount,
  http,
  login,
  pay,
  pinToken,
  refundRequests,
  rows,
  secondUserId,
} from './fixture.js';

const SECOND = 'h029-second';
/** Số lẻ (không bội 1.000) — BR-GEN-03: booking chưa xác nhận hoàn **đúng** số đã thu, không làm tròn. */
const COLLECTED = 1_234_567n;

const approve = (token: string, id: string, body: object) =>
  http()
    .post(`/api/v1/refund-requests/${id}/approve`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);

interface SystemRefund {
  readonly bookingId: string;
  readonly paymentId: string;
  readonly requestId: string;
}

/**
 * Dựng đúng trạng thái worker HB-212 để lại: booking `EXPIRED`, tiền đã thu, phân bổ **đã nhả**, nghĩa vụ
 * phòng đã void, một hồ sơ SYSTEM PENDING giữ hạn mức hoàn đúng số đã thu.
 */
async function systemRefund(amount: bigint): Promise<SystemRefund> {
  const created = await booking({ status: 'EXPIRED', price: Number(amount), nights: 1 });
  const paymentId = await pay(created.id, amount);
  await rows(
    `UPDATE payment_allocations a SET released_amount = a.amount, release_reason = 'HOLD_EXPIRED',
            updated_at = clock_timestamp()
       FROM booking_charges c
      WHERE c.id = a.charge_id AND c.booking_id = $1`,
    [created.id],
  );
  await rows(
    `UPDATE booking_charges SET voided_amount = amount, reason = coalesce(reason, 'HOLD_EXPIRED'),
            updated_at = clock_timestamp()
      WHERE booking_id = $1`,
    [created.id],
  );
  const requestId = String(
    (
      await rows(
        `INSERT INTO refund_requests(booking_id, event_key, payment_id, policy_id, hours_before_check_in,
            applied_tier_id, refund_percent, requested_amount, refund_fee, status, is_force_majeure,
            evidence_refs, reason, requested_by, requester_type, requester_id)
         SELECT $1::uuid, 'hold-expiry', $2::uuid, rp.cancellation_policy_id, 48.00, null, 100, $3,
                0, 'PENDING', false, '{}'::text[], 'PAYMENT_TIMEOUT', null, 'SYSTEM', 'hold-expiry'
           FROM bookings b JOIN rate_plans rp ON rp.id = b.rate_plan_id
          WHERE b.id = $1::uuid
         RETURNING id`,
        [created.id, paymentId, amount.toString()],
      )
    )[0]!.id,
  );
  await rows(
    `INSERT INTO refund_allocations(refund_request_id, original_payment_id, amount)
     VALUES($1::uuid, $2::uuid, $3)`,
    [requestId, paymentId, amount.toString()],
  );
  return { bookingId: created.id, paymentId, requestId };
}

test('hồ sơ SYSTEM không tự duyệt: vẫn PENDING, quầy 403, MANAGER khác người lập duyệt mới xong', async () => {
  const { bookingId, requestId } = await systemRefund(COLLECTED);

  // 1. Không tự duyệt: hồ sơ nằm PENDING, chưa có bảng duyệt và chưa có nhật ký duyệt.
  const opened = (await refundRequests(bookingId))[0]!;
  expect(opened).toMatchObject({
    status: 'PENDING',
    approved_by: null,
    decided_at: null,
    requested_by: null,
    requester_type: 'SYSTEM',
    requester_id: 'hold-expiry',
    requested_amount: COLLECTED.toString(),
    net_refund: COLLECTED.toString(),
  });
  expect(
    await rows('SELECT id FROM refund_approvals WHERE refund_request_id=$1', [requestId]),
  ).toEqual([]);
  expect(await heldAmount(bookingId)).toBe(COLLECTED.toString());

  // 2. Quầy không có quyền duyệt ở mọi mức tiền (BR-CANCEL-15).
  const staff = await login('h029-first', 'FRONT_DESK');
  const denied = await approve(staff, requestId, { approvedAmount: Number(COLLECTED) });
  expect(denied.status).toBe(403);
  expect(errorCode(denied.body)).toBe('E_RBAC_FORBIDDEN');
  expect((await refundRequests(bookingId))[0]).toMatchObject({ status: 'PENDING' });

  // 3. MANAGER (khác "người lập" SYSTEM) duyệt bằng PIN ⇒ APPROVED, đúng số, giữ nguyên hạn mức.
  const checker = await login(SECOND, 'MANAGER');
  const pin = await pinToken(checker, bookingId);
  const ok = await approve(checker, requestId, {
    approvedAmount: Number(COLLECTED),
    pinToken: pin,
    note: 'Hoàn do hết hạn giữ chỗ',
  });
  expect(ok.status).toBe(200);
  const decision = refundDecisionSchema.parse(ok.body);
  expect(decision).toMatchObject({
    status: 'APPROVED',
    requestedAmount: Number(COLLECTED),
    approvedAmount: Number(COLLECTED),
    refundPercent: 100,
    requestedBy: 'hold-expiry',
    approvedBy: secondUserId,
  });
  expect((await refundRequests(bookingId))[0]).toMatchObject({
    status: 'APPROVED',
    requested_by: null,
    approved_by: secondUserId,
    approved_amount: COLLECTED.toString(),
    net_refund: COLLECTED.toString(),
  });
  // Bản ghi duyệt độc lập do trigger đòi, và AuditLog của lượt duyệt có mặt (BR-CANCEL-15/16).
  expect(
    await rows('SELECT approver_id, decision FROM refund_approvals WHERE refund_request_id=$1', [
      requestId,
    ]),
  ).toEqual([{ approver_id: secondUserId, decision: 'APPROVED' }]);
  expect(
    Number(
      (
        await rows(
          "SELECT count(*)::int AS n FROM audit_logs WHERE action='REFUND_APPROVED' AND entity_id=$1",
          [requestId],
        )
      )[0]!.n,
    ),
  ).toBe(1);
  expect(await heldAmount(bookingId)).toBe(COLLECTED.toString());
});

test('hồ sơ SYSTEM trên ngưỡng 5 triệu: server bật cờ ngưỡng và chỉ MANAGER/OWNER duyệt được', async () => {
  const amount = 6_000_000n;
  const { bookingId, requestId } = await systemRefund(amount);

  // Không có bậc huỷ nào áp cho booking chưa xác nhận: hồ sơ để `applied_tier_id` rỗng (token
  // PRECONFIRMATION ở hợp đồng đọc) và hoàn 100% — đúng số đã thu.
  expect((await refundRequests(bookingId))[0]).toMatchObject({
    applied_tier_id: null,
    refund_percent: '100.00',
    requested_amount: amount.toString(),
    net_refund: amount.toString(),
  });

  const staff = await login('h029-first', 'FRONT_DESK');
  const denied = await approve(staff, requestId, { approvedAmount: Number(amount) });
  expect(denied.status).toBe(403);
  expect(errorCode(denied.body)).toBe('E_RBAC_FORBIDDEN');

  const checker = await login(SECOND, 'MANAGER');
  const pin = await pinToken(checker, bookingId);
  const ok = await approve(checker, requestId, {
    approvedAmount: Number(amount),
    pinToken: pin,
    note: 'Duyệt hồ sơ SYSTEM trên ngưỡng',
  });
  expect(ok.status).toBe(200);
  expect(refundDecisionSchema.parse(ok.body).status).toBe('APPROVED');
  // Cờ ngưỡng do server tính trên NET của toàn sự kiện (ADR-016) và ghi vào nhật ký duyệt — không đọc
  // SystemSetting ở client, không hardcode ngưỡng ở tầng hiển thị.
  expect(
    (
      await rows(
        `SELECT after_json ->> 'requiresThresholdControl' AS flag,
                after_json ->> 'eventNetRefund' AS net
           FROM audit_logs WHERE action='REFUND_APPROVED' AND entity_id=$1`,
        [requestId],
      )
    )[0],
  ).toEqual({ flag: 'true', net: amount.toString() });
});
