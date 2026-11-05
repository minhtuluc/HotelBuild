/**
 * HB-129 AC10 — lease/CAS inbox và phục hồi bền của worker `q.ota-inbox` (giai đoạn A, đỏ có chủ đích).
 *
 * Một ca, bốn chặng quan sát được trên CSDL/Redis thật:
 * 1. Redis mất dữ liệu: hàng `PENDING` vẫn được quét và xử lý từ CSDL; hai lượt chạy **đồng thời**
 *    không xử lý trùng một hàng (CAS lease), mỗi booking chỉ một dấu nghiệp vụ.
 * 2. `PROCESSING` còn lease **không** bị cướp; lease hết hạn thì được phục hồi, `attempts` tăng đúng
 *    một lần và `lease_token` được nhả.
 * 3. Lỗi ghi (bảng tombstone bị đổi tên) ⇒ `FAILED` + `available_at` lùi, `last_error` là mã ngắn.
 * 4. Lượt cuối (`attempt >= attempts`) ⇒ `DEAD_LETTER`, **giữ nguyên** `payload_json`, log không PII.
 */
import { Redis } from 'ioredis';
import { expect, test } from 'vitest';
import {
  REFERENCE,
  SHORT_ERROR_CODE,
  TableOutage,
  count,
  createOtaTestDb,
  inboxOf,
  insertInbox,
  instantOf,
  makeContext,
  otaInboxHandler,
  one,
  seedWorkerReference,
  testRedisUrl,
  text,
} from './fixture.js';

test('lease-and-durable-recovery', async () => {
  const testDb = await createOtaTestDb('recovery');
  const redis = new Redis(testRedisUrl());
  try {
    await seedWorkerReference(testDb.rows);
    const handler = otaInboxHandler();
    const { context, logs } = makeContext(testDb.db, testDb.ownerUrl);
    await redis.flushdb();

    const first = await insertInbox(testDb.rows, {
      eventId: 'hb129-w-rec-1',
      code: 'HB129-W-REC-1',
    });
    const second = await insertInbox(testDb.rows, {
      eventId: 'hb129-w-rec-2',
      code: 'HB129-W-REC-2',
    });
    await Promise.all([handler({}, context), handler({}, context)]);
    for (const seed of [first, second]) {
      const row = one(await inboxOf(testDb.rows, seed.eventId));
      expect(text(row.status), seed.eventId).toBe('PROCESSED');
      expect(count(row.attempts), seed.eventId).toBeGreaterThanOrEqual(1);
      expect(row.lease_token, seed.eventId).toBeNull();
    }
    const marks = await testDb.rows(
      'SELECT provider_booking_code FROM channel_cancel_tombstones ORDER BY provider_booking_code',
    );
    expect(marks.map((row) => text(row.provider_booking_code))).toEqual([
      'HB129-W-REC-1',
      'HB129-W-REC-2',
    ]);
    expect(await testDb.rows('SELECT id FROM bookings')).toHaveLength(0);

    const leased = await insertInbox(testDb.rows, {
      eventId: 'hb129-w-lease',
      code: 'HB129-W-LEASE',
    });
    await testDb.rows(
      `UPDATE webhook_inbox SET status='PROCESSING', lease_token=gen_random_uuid(),
         lease_expires_at='2026-12-01T00:10:00.000Z' WHERE event_id=$1`,
      [leased.eventId],
    );
    await handler({}, context);
    expect(text(one(await inboxOf(testDb.rows, leased.eventId)).status)).toBe('PROCESSING');

    await testDb.rows(
      "UPDATE webhook_inbox SET lease_expires_at='2026-11-30T00:00:00.000Z' WHERE event_id=$1",
      [leased.eventId],
    );
    await handler({}, context);
    const recovered = one(await inboxOf(testDb.rows, leased.eventId));
    expect(text(recovered.status)).toBe('PROCESSED');
    expect(recovered.lease_token).toBeNull();
    expect(count(recovered.attempts)).toBe(1);
    expect(
      count(
        one(
          await testDb.rows(
            "SELECT count(*) AS n FROM channel_cancel_tombstones WHERE provider_booking_code='HB129-W-LEASE'",
          ),
        ).n,
      ),
    ).toBe(1);

    const failing = await insertInbox(testDb.rows, {
      eventId: 'hb129-w-fail',
      code: 'HB129-W-FAIL',
    });
    const firstOutage = await TableOutage.start(
      testDb.rows,
      'channel_cancel_tombstones',
      'hb129w1',
    );
    try {
      await handler({ eventId: failing.eventId }, context, { attempt: 1, attempts: 3 });
    } finally {
      await firstOutage.restore(testDb.rows);
    }
    const failed = one(await inboxOf(testDb.rows, failing.eventId));
    expect(text(failed.status)).toBe('FAILED');
    expect(instantOf(failed.available_at)).toBeGreaterThan(context.clock.now().getTime());
    expect(text(failed.last_error)).toMatch(SHORT_ERROR_CODE);
    expect(text(failed.last_error)).not.toContain(REFERENCE.guestPhone);

    await testDb.rows(
      "UPDATE webhook_inbox SET available_at='2026-11-30T00:00:00.000Z' WHERE event_id=$1",
      [failing.eventId],
    );
    const secondOutage = await TableOutage.start(
      testDb.rows,
      'channel_cancel_tombstones',
      'hb129w2',
    );
    try {
      await handler({ eventId: failing.eventId }, context, { attempt: 3, attempts: 3 });
    } finally {
      await secondOutage.restore(testDb.rows);
    }
    const dead = one(await inboxOf(testDb.rows, failing.eventId));
    expect(text(dead.status)).toBe('DEAD_LETTER');
    expect(dead.payload_json).toEqual(failed.payload_json);
    expect(text(dead.last_error)).toMatch(SHORT_ERROR_CODE);
    expect(JSON.stringify(logs)).not.toContain(REFERENCE.guestPhone);
    expect(JSON.stringify(logs)).not.toContain(REFERENCE.guestName);
    expect(
      await testDb.rows(
        "SELECT 1 FROM channel_cancel_tombstones WHERE provider_booking_code='HB129-W-FAIL'",
      ),
    ).toHaveLength(0);
  } finally {
    await redis.quit();
    await testDb.close();
  }
}, 180000);
