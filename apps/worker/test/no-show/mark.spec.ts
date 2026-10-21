import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noShowMarkJob } from '../../src/jobs/no-show/no-show.job.js';
import {
  createNoShowTestDb,
  makeNoShowContext,
  noShowState,
  type NoShowTestDb,
} from './harness.js';
import { businessClock, seedNoShow } from './seed.js';

/**
 * HB-147 — job `q.no-show-mark` trên PostgreSQL16 thật (BR-CANCEL-10, BR-CANCEL-06, BR-FO-02).
 *
 * Mốc 23:59 đọc theo giờ CSDL; để ca "đã qua mốc" không phụ thuộc giờ chạy test, `NO_SHOW_MARK_TIME`
 * được đặt `00:00` (mốc đầu ngày luôn đã qua). Ca "chưa tới mốc" đặt mốc theo giờ VN hiện tại + 2 phút —
 * chỉ nhập nhằng trong hai phút cuối ngày, khi đó mốc `23:59:59` vẫn còn ở tương lai.
 */
describe('HB-147 — quét no-show lúc 23:59', () => {
  let testDb: NoShowTestDb;

  beforeAll(async () => {
    testDb = await createNoShowTestDb('mark');
  }, 120_000);

  afterAll(async () => {
    await testDb.close();
  }, 30_000);

  const passed = () =>
    makeNoShowContext(testDb.db, testDb.ownerUrl, {
      NO_SHOW_MARK_TIME: '00:00',
      NO_SHOW_BATCH_SIZE: 50,
    });

  it('booking CONFIRMED hôm nay → NO_SHOW, phạt đêm đầu, nhả phân công, history + audit + outbox', async () => {
    const fixture = await seedNoShow(testDb.db, { label: 'due', paid: 300_000 });
    const h = passed();
    await noShowMarkJob({}, h.context);

    const state = await noShowState(testDb.db, fixture);
    expect(state.status).toBe('NO_SHOW');
    // BR-CANCEL-06: max(0, 1.100.000 − 300.000).
    expect(state.penaltyAmount).toBe('800000');
    expect(state.balanceDue).toBe('800000');
    expect(state.paidAmount).toBe('300000');
    expect(state.totalAmount).toBe('0');
    expect(state.roomVoided).toBe('0');
    expect(state.activeAssignments).toBe(0);
    expect(state.releaseReasons).toEqual(['NO_SHOW']);
    expect(state.history).toEqual([{ from: 'CONFIRMED', to: 'NO_SHOW', reason: 'NO_SHOW' }]);
    expect(state.audit).toEqual([
      {
        action: 'BOOKING_NO_SHOW',
        actorRole: 'SYSTEM',
        actorId: null,
        after: { status: 'NO_SHOW', releasedAssignments: 1, penaltyAmount: '800000' },
      },
    ]);
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]?.eventType).toBe('InventoryChanged');
    expect(state.outbox[0]?.operation).toBe('NO_SHOW');
    expect(state.outbox[0]?.roomIds).toEqual([...fixture.roomIds]);
    expect(state.penaltyCharges).toEqual([{ amount: '800000', voidedAmount: '0' }]);
    expect(state.penaltyPayments).toEqual([
      { status: 'PENDING', method: 'BANK_TRANSFER', amount: '800000' },
    ]);
    expect(h.logs.at(-1) ?? '').toContain('1 đánh dấu');
  });

  it('chạy lại (cùng hoặc khác worker) không ghi thêm lần hai', async () => {
    const fixture = await seedNoShow(testDb.db, { label: 'replay', paid: 300_000 });
    const h = passed();
    await noShowMarkJob({}, h.context);
    const first = await noShowState(testDb.db, fixture);

    await noShowMarkJob({}, h.context);
    const second = await noShowState(testDb.db, fixture);
    expect(second).toEqual(first);
    expect(second.penaltyCharges).toHaveLength(1);
    expect(second.penaltyPayments).toHaveLength(1);
    expect(h.logs.at(-1) ?? '').toContain('0 đánh dấu');
  });

  it('booking đã CHECKED_IN không bị đụng', async () => {
    const fixture = await seedNoShow(testDb.db, { label: 'stayed', status: 'CHECKED_IN' });
    const h = passed();
    await noShowMarkJob({}, h.context);

    const state = await noShowState(testDb.db, fixture);
    expect(state.status).toBe('CHECKED_IN');
    expect(state.activeAssignments).toBe(1);
    expect(state.penaltyCharges).toEqual([]);
    expect(state.penaltyPayments).toEqual([]);
    expect(state.history).toEqual([]);
  });

  it('chỉ đánh dấu booking có check_in là ngày nghiệp vụ hôm nay', async () => {
    const tomorrow = await seedNoShow(testDb.db, { label: 'future', checkInOffsetDays: 1 });
    const yesterday = await seedNoShow(testDb.db, { label: 'past', checkInOffsetDays: -1 });
    const h = passed();
    await noShowMarkJob({}, h.context);

    for (const fixture of [tomorrow, yesterday]) {
      const state = await noShowState(testDb.db, fixture);
      expect(state.status).toBe('CONFIRMED');
      expect(state.activeAssignments).toBe(1);
      expect(state.penaltyCharges).toEqual([]);
    }
  });

  it('chưa tới mốc trong ngày thì chưa đánh dấu', async () => {
    const fixture = await seedNoShow(testDb.db, { label: 'early' });
    const now = await businessClock(testDb.db);
    const seconds = now.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    const future =
      seconds + 120 >= 86_400
        ? '23:59:59'
        : new Date(seconds * 1000 + 120_000).toISOString().slice(11, 19);
    const h = makeNoShowContext(testDb.db, testDb.ownerUrl, {
      NO_SHOW_MARK_TIME: future,
      NO_SHOW_BATCH_SIZE: 50,
    });
    await noShowMarkJob({}, h.context);

    const state = await noShowState(testDb.db, fixture);
    expect(state.status).toBe('CONFIRMED');
    expect(state.penaltyCharges).toEqual([]);
    expect(state.activeAssignments).toBe(1);
  });

  it('bậc cuối miễn phạt đêm đầu ⇒ NO_SHOW nhưng không sinh công nợ', async () => {
    const fixture = await seedNoShow(testDb.db, {
      label: 'nopenalty',
      paid: 300_000,
      chargeFirstNight: false,
    });
    const h = passed();
    await noShowMarkJob({}, h.context);

    const state = await noShowState(testDb.db, fixture);
    expect(state.status).toBe('NO_SHOW');
    expect(state.penaltyAmount).toBe('0');
    expect(state.balanceDue).toBe('0');
    expect(state.penaltyCharges).toEqual([]);
    expect(state.penaltyPayments).toEqual([]);
    expect(state.roomVoided).toBe('0');
    expect(state.activeAssignments).toBe(0);
  });
});
