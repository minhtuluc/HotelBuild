import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { expireHold } from '../../src/jobs/hold-expiry/expire.js';
import { holdExpiryJob } from '../../src/jobs/hold-expiry/hold-expiry.job.js';
import {
  createHoldTestDb,
  holdState,
  makeHoldContext,
  seedHold,
  type HoldTestDb,
} from './harness.js';

/**
 * HB-078 AC2 — callback thanh toán và job hết hạn đến cùng lúc: hai transaction **đan xen** trên hai kết
 * nối thật, chỉ một bên thắng và booking **không hồi sinh** (BR-BOOK-06/09/18, BR-PAY-11).
 *
 * Phía "callback" ở đây là câu lệnh mô phỏng đúng hợp đồng mà tuyến callback sẽ dùng: khoá Booking,
 * **đọc lại** trạng thái + hạn bằng `clock_timestamp()`, và chỉ xác nhận khi `status IN ('HELD',
 * 'PENDING_PAYMENT') AND hold_expires_at > clock_timestamp()`.
 */
describe('HB-078 — đua tranh callback ↔ job hết hạn', () => {
  let testDb: HoldTestDb;

  beforeAll(async () => {
    testDb = await createHoldTestDb('race');
  }, 120_000);

  afterAll(async () => {
    await testDb.close();
  }, 30_000);

  it('callback giữ khoá Booking trước ⇒ lượt hết hạn chờ rồi bỏ qua, không nhả phòng của booking đã xác nhận', async () => {
    const fixture = await seedHold(testDb.db, {
      label: 'callback-first',
      // Hạn sắp tới: callback kịp xác nhận trong lúc lượt quét cũng đang nhặt booking này.
      expiresInSeconds: 30,
    });
    const callback = new pg.Client({ connectionString: testDb.ownerUrl });
    await callback.connect();
    const context = makeHoldContext(testDb.db, testDb.ownerUrl);
    try {
      await callback.query('BEGIN');
      await callback.query('SELECT id FROM bookings WHERE id = $1::uuid FOR UPDATE', [
        fixture.bookingId,
      ]);
      let settled = false;
      const expiry = expireHold(testDb.db, fixture.bookingId).finally(() => {
        settled = true;
      });
      const tick = Promise.withResolvers<void>();
      setTimeout(tick.resolve, 300);
      await tick.promise;
      // Bằng chứng đan xen: lượt hết hạn đang chờ khoá của callback, chưa chốt được gì.
      expect(settled).toBe(false);

      const confirmed = await callback.query(
        `UPDATE bookings
            SET status = 'CONFIRMED', updated_at = clock_timestamp(), version = version + 1
          WHERE id = $1::uuid AND status IN ('HELD', 'PENDING_PAYMENT')
            AND hold_expires_at > clock_timestamp()`,
        [fixture.bookingId],
      );
      await callback.query(
        `INSERT INTO booking_status_history(booking_id, from_status, to_status, reason)
         VALUES ($1::uuid, 'HELD', 'CONFIRMED', 'PAYMENT_CONFIRMED')`,
        [fixture.bookingId],
      );
      await callback.query('COMMIT');
      expect(confirmed.rowCount).toBe(1);

      await expect(expiry).resolves.toMatchObject({ expired: false, releasedAssignments: 0 });
    } finally {
      await callback.end();
    }

    // Lượt quét sau đó cũng không được đụng vào booking đã xác nhận.
    await holdExpiryJob({}, context.context);
    const state = await holdState(testDb.db, fixture);
    expect(state.status).toBe('CONFIRMED');
    expect(state.activeAssignments).toBe(1);
    expect(state.releasedAssignments).toBe(0);
    expect(state.history.map((row) => row.to)).toEqual(['CONFIRMED']);
    expect(state.audit).toEqual([]);
  });

  it('lượt hết hạn chốt trước ⇒ callback muộn bị guard CSDL từ chối, booking không hồi sinh', async () => {
    const fixture = await seedHold(testDb.db, { label: 'expiry-first', expiresInSeconds: -120 });
    const callback = new pg.Client({ connectionString: testDb.ownerUrl });
    await callback.connect();
    try {
      await callback.query('BEGIN');
      // Hai transaction chạy chồng nhau trên cùng hàng: bên nào lấy khoá trước thì bên kia chờ.
      const [outcome] = await Promise.all([
        expireHold(testDb.db, fixture.bookingId),
        callback.query('SELECT id FROM bookings WHERE id = $1::uuid FOR UPDATE', [
          fixture.bookingId,
        ]),
      ]);
      expect(outcome.expired).toBe(true);

      const locked = await callback.query<{ status: string; hold_expires_at: Date }>(
        `SELECT status, hold_expires_at FROM bookings WHERE id = $1::uuid`,
        [fixture.bookingId],
      );
      expect(locked.rows[0]?.status).toBe('EXPIRED');

      const confirmed = await callback.query(
        `UPDATE bookings
            SET status = 'CONFIRMED', updated_at = clock_timestamp()
          WHERE id = $1::uuid AND status IN ('HELD', 'PENDING_PAYMENT')
            AND hold_expires_at > clock_timestamp()`,
        [fixture.bookingId],
      );
      await callback.query('COMMIT');
      // Guard là mệnh đề duy nhất quyết định: hết hạn ⇒ không hàng nào đổi trạng thái (BR-PAY-11).
      expect(confirmed.rowCount).toBe(0);
    } finally {
      await callback.end();
    }

    const state = await holdState(testDb.db, fixture);
    expect(state.status).toBe('EXPIRED');
    expect(state.history.map((row) => row.to)).toEqual(['EXPIRED']);
    expect(state.releasedAssignments).toBe(1);
    expect(state.activeAssignments).toBe(0);
  });
});
