/**
 * HB-212 — hết hạn giữ chỗ khi PSP **đã thu tiền** (F5-QA-01), trên PostgreSQL16 thật.
 *
 * Ca chứng minh bốn điều của ticket: (1) EXPIRED + **đúng một** hồ sơ hoàn **đúng số đã thu** trong cùng
 * transaction; (2) chạy lại job (kể cả hai lượt **đồng thời**) không lập hồ sơ thứ hai; (3) booking không có
 * tiền giữ nguyên hành vi HB-078; (4) khoản tiền đã được hồ sơ thu muộn (BR-PAY-11) giữ thì không lập hồ sơ
 * thứ hai cho cùng khoản.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expireHold } from '../../src/jobs/hold-expiry/expire.js';
import { createHoldExpiryJob } from '../../src/jobs/hold-expiry/hold-expiry.job.js';
import {
  HOLD_REFUND_AUDIT_ACTION,
  HOLD_REFUND_EVENT_KEY,
  HOLD_REFUND_OUTBOX_EVENT,
  HOLD_REFUND_REASON,
  HOLD_REFUND_REQUESTER,
} from '../../src/jobs/hold-expiry/refund.js';
import {
  createHoldTestDb,
  holdState,
  makeHoldContext,
  seedHold,
  type HoldHarness,
  type HoldTestDb,
} from './harness.js';
import {
  holdRefundState,
  seedCollectedHold,
  seedLateRefund,
  type HoldRefundState,
} from './refund-harness.js';

/** Số lẻ (không phải bội 1.000) để chứng minh **không** làm tròn xuống (BR-GEN-03 ngoại lệ BR-BOOK-18). */
const COLLECTED = 1_234_567n;

/** Đếm hồ sơ hoàn của booking **bằng truy vấn** — bằng chứng idempotency của lượt chạy lại. */
async function countRequests(testDb: HoldTestDb, bookingId: string): Promise<number> {
  const rows = await testDb.rows(
    'SELECT count(*)::int AS n FROM refund_requests WHERE booking_id=$1',
    [bookingId],
  );
  return Number(rows[0]!.n);
}

/** Tổng tiền **đang giữ hạn mức** (BR-CANCEL-17) theo từng nguồn thu đã phân bổ. */
function heldTotal(refund: HoldRefundState): bigint {
  return refund.allocations.reduce((sum, row) => sum + BigInt(row.amount), 0n);
}

describe('HB-212 — hết hạn giữ chỗ khi đã thu tiền', () => {
  let testDb: HoldTestDb;
  let h: HoldHarness;

  beforeAll(async () => {
    testDb = await createHoldTestDb('refund');
    h = makeHoldContext(testDb.db, testDb.ownerUrl);
  }, 120_000);

  afterAll(async () => {
    await testDb.close();
  }, 30_000);

  it('có tiền ⇒ EXPIRED + đúng một hồ sơ hoàn đúng số đã thu, audit + outbox cùng transaction', async () => {
    const { fixture, paymentId } = await seedCollectedHold(testDb.db, {
      label: 'paid',
      expiresInSeconds: -20,
      status: 'PENDING_PAYMENT',
      paidAmount: COLLECTED,
    });
    await createHoldExpiryJob()({ mode: 'SWEEP' }, h.context);

    const state = await holdState(testDb.db, fixture);
    expect(state.status).toBe('EXPIRED');
    expect(state.activeAssignments).toBe(0);

    const refund = await holdRefundState(testDb.db, fixture.bookingId);
    expect(refund.requests).toHaveLength(1);
    expect(refund.requests[0]).toMatchObject({
      eventKey: HOLD_REFUND_EVENT_KEY,
      status: 'PENDING',
      // `requested_by = SYSTEM` theo QĐ-07 mục 2: SYSTEM nghĩa là `requested_by` rỗng + `requester_type`
      // SYSTEM (ràng buộc `ck_refund_requester`), nên không ai có thể "tự duyệt" hồ sơ này.
      requesterType: 'SYSTEM',
      requesterId: HOLD_REFUND_REQUESTER,
      requestedBy: null,
      // Hoàn **đúng** số đã thu: không bậc phí huỷ, không phí, không làm tròn.
      requestedAmount: COLLECTED.toString(),
      refundFee: '0',
      netRefund: COLLECTED.toString(),
      refundPercent: '100.00',
      reason: HOLD_REFUND_REASON,
      appliedTierId: null,
      paymentId,
    });
    // Giữ hạn mức hoàn theo đúng nguồn thu (BR-CANCEL-17) — chưa duyệt thì vẫn PENDING.
    expect(refund.allocations).toEqual([
      { requestId: refund.requests[0]!.id, paymentId, amount: COLLECTED.toString() },
    ]);
    // Tiền được nhả khỏi nghĩa vụ để chính nó là nguồn của khoản hoàn (không giữ hai chỗ một đồng).
    expect(refund.allocationsReleased.map((row) => row.released)).toEqual(
      refund.allocationsReleased.map((row) => row.amount),
    );
    expect(refund.allocationsReleased.every((row) => row.reason === 'HOLD_EXPIRED')).toBe(true);
    expect(refund.charges.map((row) => row.voided)).toEqual(
      refund.charges.map((row) => row.amount),
    );
    // Audit + outbox của hồ sơ nằm trong cùng transaction với bước chuyển EXPIRED.
    expect(refund.audit).toEqual([
      {
        action: HOLD_REFUND_AUDIT_ACTION,
        actorRole: 'SYSTEM',
        actorId: null,
        requestedAmount: COLLECTED.toString(),
      },
    ]);
    expect(refund.outbox).toHaveLength(1);
    expect(refund.outbox[0]?.eventType).toBe(HOLD_REFUND_OUTBOX_EVENT);
    expect(refund.outbox[0]?.aggregateType).toBe('RefundRequest');
    expect(refund.outbox[0]?.payload).toMatchObject({
      refundRequestId: refund.requests[0]!.id,
      requestedAmount: COLLECTED.toString(),
      requesterType: 'SYSTEM',
    });
    expect(h.logs.at(-1) ?? '').toContain(`lập 1 hồ sơ hoàn (${COLLECTED} VND)`);
  });

  it('chạy lại job ⇒ vẫn đúng một hồ sơ cho cùng booking + nguyên nhân (đếm bằng truy vấn)', async () => {
    const { fixture } = await seedCollectedHold(testDb.db, {
      label: 'twice',
      expiresInSeconds: -30,
      paidAmount: COLLECTED,
    });
    await createHoldExpiryJob()({ mode: 'SWEEP' }, h.context);
    const first = await holdRefundState(testDb.db, fixture.bookingId);
    expect(first.requests).toHaveLength(1);

    // Lượt thứ hai: booking đã EXPIRED nên không còn là ứng viên, khoá chống trùng vẫn giữ nguyên.
    await createHoldExpiryJob()({ mode: 'SWEEP' }, h.context);
    expect(await countRequests(testDb, fixture.bookingId)).toBe(1);
    expect(await holdRefundState(testDb.db, fixture.bookingId)).toEqual(first);
  });

  it('hai lượt hết hạn đồng thời (hai tiến trình) ⇒ chỉ một hồ sơ, khoá booking quyết định', async () => {
    const { fixture } = await seedCollectedHold(testDb.db, {
      label: 'race',
      expiresInSeconds: -15,
      paidAmount: COLLECTED,
    });
    const outcomes = await Promise.all([
      expireHold(testDb.db, fixture.bookingId),
      expireHold(testDb.db, fixture.bookingId),
    ]);
    expect(outcomes.filter((outcome) => outcome.expired)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.refundRequestId !== null)).toHaveLength(1);

    const refund = await holdRefundState(testDb.db, fixture.bookingId);
    expect(refund.requests).toHaveLength(1);
    expect(refund.requests[0]?.requestedAmount).toBe(COLLECTED.toString());
    expect(heldTotal(refund)).toBe(COLLECTED);
  });

  it('không có tiền ⇒ không lập hồ sơ, hành vi HB-078 giữ nguyên', async () => {
    const fixture = await seedHold(testDb.db, { label: 'unpaid', expiresInSeconds: -10 });
    await createHoldExpiryJob()({ mode: 'SWEEP' }, h.context);

    const state = await holdState(testDb.db, fixture);
    expect(state.status).toBe('EXPIRED');
    expect(state.history).toEqual([{ from: 'HELD', to: 'EXPIRED', reason: 'HOLD_EXPIRED' }]);
    const refund = await holdRefundState(testDb.db, fixture.bookingId);
    expect(refund.requests).toEqual([]);
    expect(refund.allocations).toEqual([]);
    expect(refund.audit).toEqual([]);
    expect(refund.outbox).toEqual([]);
  });

  it('tiền đã được hồ sơ thu muộn (BR-PAY-11) giữ ⇒ không lập hồ sơ thứ hai cho cùng khoản', async () => {
    const { fixture, paymentId } = await seedCollectedHold(testDb.db, {
      label: 'late',
      expiresInSeconds: -25,
      paidAmount: COLLECTED,
    });
    const late = await seedLateRefund(testDb.db, {
      bookingId: fixture.bookingId,
      paymentId,
      amount: COLLECTED,
    });
    await createHoldExpiryJob()({ mode: 'SWEEP' }, h.context);

    expect((await holdState(testDb.db, fixture)).status).toBe('EXPIRED');
    const refund = await holdRefundState(testDb.db, fixture.bookingId);
    expect(refund.requests.map((row) => row.id)).toEqual([late]);
    expect(refund.requests[0]?.eventKey).toBe(`psp-late:${paymentId}`);
    // Tổng giữ hạn mức vẫn đúng bằng số đã thu, không nhân đôi khoản hoàn.
    expect(heldTotal(refund)).toBe(COLLECTED);
  });
});
