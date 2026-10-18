import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHoldExpiryJob, holdExpiryJob } from '../../src/jobs/hold-expiry/hold-expiry.job.js';
import {
  createHoldTestDb,
  holdState,
  makeHoldContext,
  seedHold,
  type HoldHarness,
  type HoldTestDb,
} from './harness.js';

/**
 * HB-078 — quét hết hạn trên PostgreSQL16 thật (AC1, AC4 phần "hold chưa hết hạn không bị đụng").
 *
 * Các ca dùng chung một CSDL nên **thứ tự có ý nghĩa**: mỗi ca dọn hết hold quá hạn của mình trước khi ca
 * sau đọc dòng tổng kết (job quét cả CSDL, không lọc theo cơ sở).
 */
describe('HB-078 — quét hết hạn giữ chỗ', () => {
  let testDb: HoldTestDb;
  let h: HoldHarness;

  beforeAll(async () => {
    testDb = await createHoldTestDb('expire');
    h = makeHoldContext(testDb.db, testDb.ownerUrl);
  }, 120_000);

  afterAll(async () => {
    await testDb.close();
  });

  it('hold quá hạn → EXPIRED + nhả phân công/allotment + history + audit + outbox trong một transaction', async () => {
    const fixture = await seedHold(testDb.db, {
      label: 'due',
      // Quá hạn 20 giây < trần SLA 60 giây ⇒ lượt quét bắt đúng hạn, không tính là bỏ sót.
      expiresInSeconds: -20,
      units: 2,
      allotmentUsed: 2,
    });
    await holdExpiryJob({ mode: 'SWEEP' }, h.context);

    const state = await holdState(testDb.db, fixture);
    expect(state.status).toBe('EXPIRED');
    expect(state.activeAssignments).toBe(0);
    expect(state.releasedAssignments).toBe(2);
    expect(state.releaseReasons).toEqual(['HOLD_EXPIRED', 'HOLD_EXPIRED']);
    expect(state.history).toEqual([{ from: 'HELD', to: 'EXPIRED', reason: 'HOLD_EXPIRED' }]);
    expect(state.audit).toEqual([
      {
        action: 'BOOKING_EXPIRED',
        actorRole: 'SYSTEM',
        actorId: null,
        after: { status: 'EXPIRED', releasedAssignments: 2, releasedAllotments: 2 },
      },
    ]);
    // Thứ tự `roomIds` theo `room_assignments.id` (uuid) nên so theo tập, không theo thứ tự seed.
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]?.eventType).toBe('InventoryChanged');
    expect(state.outbox[0]?.operation).toBe('HOLD_EXPIRED');
    expect([...(state.outbox[0]?.roomIds ?? [])].sort()).toEqual([...fixture.roomIds].sort());
    // Hai đêm ở ⇒ hai hàng allotment được nhả về 0.
    expect(state.allotmentUsed).toEqual([0, 0]);
    const summary = h.logs.at(-1) ?? '';
    expect(summary).toContain('quét hết hạn (SWEEP): 1 đến hạn, 1 hết hạn');
    expect(summary).toContain('nhả 2 phân công + 2 hàng allotment, 0 quá hạn SLA');

    // Phòng thật sự trở về tồn khả dụng: ràng buộc loại trừ `WHERE released_at IS NULL` cho gán lại.
    await expect(
      testDb.db.$executeRaw`
        INSERT INTO room_assignments(booking_room_id, room_id, start_date, end_date)
        SELECT br.id, ${fixture.roomIds[0]!}::uuid, ${fixture.checkIn}::date, ${fixture.checkOut}::date
          FROM booking_rooms br WHERE br.id = ${fixture.bookingRoomIds[0]!}::uuid`,
    ).resolves.toBe(1);
  });

  it('hold chưa hết hạn không bị đụng, dù đồng hồ tiến trình đã ở 2099 (quyết định theo giờ CSDL)', async () => {
    const fixture = await seedHold(testDb.db, {
      label: 'future',
      expiresInSeconds: 3600,
      allotmentUsed: 1,
    });
    await holdExpiryJob({}, h.context);

    const state = await holdState(testDb.db, fixture);
    expect(state.status).toBe('HELD');
    expect(state.activeAssignments).toBe(1);
    expect(state.releasedAssignments).toBe(0);
    expect(state.history).toEqual([]);
    expect(state.audit).toEqual([]);
    expect(state.outbox).toEqual([]);
    expect(state.allotmentUsed).toEqual([1, 1]);
    expect(h.logs.at(-1) ?? '').toContain('0 đến hạn, 0 hết hạn');
  });

  it('PENDING_PAYMENT quá hạn cũng hết hạn và giữ đúng trạng thái nguồn trong history', async () => {
    const fixture = await seedHold(testDb.db, {
      label: 'pending',
      expiresInSeconds: -5,
      status: 'PENDING_PAYMENT',
    });
    await holdExpiryJob({}, h.context);

    const state = await holdState(testDb.db, fixture);
    expect(state.status).toBe('EXPIRED');
    expect(state.history).toEqual([
      { from: 'PENDING_PAYMENT', to: 'EXPIRED', reason: 'HOLD_EXPIRED' },
    ]);
  });

  it('mỗi lượt chỉ lấy một trang theo HOLD_EXPIRY_BATCH_SIZE, lượt sau nhặt phần còn lại', async () => {
    const bounded = makeHoldContext(testDb.db, testDb.ownerUrl, { HOLD_EXPIRY_BATCH_SIZE: 1 });
    const older = await seedHold(testDb.db, { label: 'batch-old', expiresInSeconds: -90 });
    const newer = await seedHold(testDb.db, { label: 'batch-new', expiresInSeconds: -60 });

    await holdExpiryJob({}, bounded.context);
    expect((await holdState(testDb.db, older)).status).toBe('EXPIRED');
    expect((await holdState(testDb.db, newer)).status).toBe('HELD');

    await holdExpiryJob({}, bounded.context);
    expect((await holdState(testDb.db, newer)).status).toBe('EXPIRED');
  });

  it('chạy lại không sinh bản ghi thứ hai (booking đã EXPIRED thì không còn là ứng viên)', async () => {
    const fixture = await seedHold(testDb.db, {
      label: 'twice',
      expiresInSeconds: -30,
      allotmentUsed: 1,
    });
    await holdExpiryJob({}, h.context);
    const first = await holdState(testDb.db, fixture);
    await holdExpiryJob({}, h.context);
    expect(await holdState(testDb.db, fixture)).toEqual(first);
  });

  it('lượt đối chiếu 900 giây bắt được booking bỏ sót và ghi mã lỗi Redis an toàn (AC3, TD-01)', async () => {
    const missed = await seedHold(testDb.db, { label: 'missed', expiresInSeconds: -600 });
    const recent = await seedHold(testDb.db, { label: 'recent', expiresInSeconds: -5 });
    const reconcile = makeHoldContext(testDb.db, testDb.ownerUrl);
    // Phiên Redis lỗi có message thô mang số điện thoại: không được lọt vào log.
    const handler = createHoldExpiryJob({
      createProjection: () => {
        throw new Error('raw message có PII 0905123456');
      },
    });

    await expect(handler({ mode: 'RECONCILE' }, reconcile.context)).resolves.toBeUndefined();

    expect((await holdState(testDb.db, missed)).status).toBe('EXPIRED');
    expect((await holdState(testDb.db, recent)).status).toBe('EXPIRED');
    const summary = reconcile.logs.find((line) => line.includes('quét hết hạn (RECONCILE)')) ?? '';
    expect(summary).toContain('2 đến hạn, 2 hết hạn');
    // Quá hạn 600 giây > trần SLA 60 giây (2 nhịp × 30 giây) ⇒ đếm là bỏ sót.
    expect(summary).toContain('1 quá hạn SLA');
    const failure = reconcile.logs.find((line) => line.startsWith('error|')) ?? '';
    expect(failure).toContain('đối chiếu Hold lỗi (mã UNKNOWN)');
    expect(reconcile.logs.join('\n')).not.toContain('0905123456');
    expect(reconcile.logs.join('\n')).not.toContain('raw message');
  });

  it('payload sai bị từ chối bằng mã ổn định, không kèm nội dung payload', async () => {
    await expect(holdExpiryJob({ mode: 'KHONG_CO' }, h.context)).rejects.toThrow(
      'HOLD_EXPIRY_PAYLOAD_INVALID',
    );
    await expect(holdExpiryJob({ thua: true }, h.context)).rejects.toThrow(
      'HOLD_EXPIRY_PAYLOAD_INVALID',
    );
  });
});
