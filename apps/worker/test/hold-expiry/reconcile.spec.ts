import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { expireHold } from '../../src/jobs/hold-expiry/expire.js';
import { createHoldExpiryJob } from '../../src/jobs/hold-expiry/hold-expiry.job.js';
import {
  createHoldProjectionSession,
  reconcileHoldProjection,
} from '../../src/jobs/hold-expiry/projection.js';
import {
  createHoldTestDb,
  holdRecordJson,
  holdState,
  makeHoldContext,
  readHoldRecord,
  redisUrlOffsetBy,
  seedHold,
  type HoldTestDb,
} from './harness.js';

/**
 * HB-078 AC3 — lượt đối chiếu 900 giây sửa **projection** `hold:<bookingId>` cho khớp
 * `bookings.hold_expires_at` (nguồn chân lý), trên Redis 7 thật.
 *
 * File này dùng **DB Redis riêng của mình** (`REDIS_URL` + 0) và dọn sạch khoá `hold:*` sau mỗi ca: lượt
 * đối chiếu đọc mọi khoá `hold:*` nên số đếm chỉ xác định khi không lẫn khoá của ca/file khác.
 */
const redisUrl = process.env.REDIS_URL ?? '';
if (redisUrl === '')
  process.stderr.write('[skip] HB-078 AC3 cần REDIS_URL để kiểm đối chiếu projection Hold.\n');

const PAST = new Date('2026-10-18T00:00:00.000Z').toISOString();
const FUTURE = new Date('2026-10-19T00:00:00.000Z').toISOString();

async function clearHoldKeys(redis: Redis): Promise<void> {
  const keys = await redis.keys('hold:*');
  if (keys.length > 0) await redis.del(...keys);
}

describe.skipIf(redisUrl === '')('HB-078 — đối chiếu projection Hold', () => {
  let testDb: HoldTestDb;
  let redis: Redis;
  let isolated = '';

  beforeAll(async () => {
    testDb = await createHoldTestDb('reconcile');
    isolated = redisUrlOffsetBy(redisUrl, 0);
    redis = new Redis(isolated);
  }, 120_000);

  afterEach(async () => {
    await clearHoldKeys(redis);
  });

  afterAll(async () => {
    await redis.quit();
    await testDb.close();
  }, 30_000);

  it('sửa bản ghi ACTIVE mất hiệu lực, xoá mồ côi, giữ bản ghi còn hiệu lực, đếm bản ghi không đọc được', async () => {
    const stale = await seedHold(testDb.db, { label: 'stale', expiresInSeconds: -300 });
    await expireHold(testDb.db, stale.bookingId);
    const live = await seedHold(testDb.db, { label: 'live', expiresInSeconds: 3600 });
    const released = await seedHold(testDb.db, { label: 'released', expiresInSeconds: -300 });
    await expireHold(testDb.db, released.bookingId);
    const orphanId = randomUUID();
    await redis.set(
      `hold:${stale.bookingId}`,
      holdRecordJson({ bookingId: stale.bookingId, channelId: stale.channelId, expiresAt: PAST }),
      'EX',
      900,
    );
    await redis.set(
      `hold:${live.bookingId}`,
      holdRecordJson({ bookingId: live.bookingId, channelId: live.channelId, expiresAt: FUTURE }),
      'EX',
      900,
    );
    await redis.set(
      `hold:${released.bookingId}`,
      holdRecordJson({
        bookingId: released.bookingId,
        channelId: released.channelId,
        expiresAt: PAST,
        status: 'RELEASED',
        releasedAt: PAST,
      }),
      'EX',
      900,
    );
    await redis.set(
      `hold:${orphanId}`,
      holdRecordJson({ bookingId: orphanId, channelId: live.channelId, expiresAt: PAST }),
      'EX',
      900,
    );
    await redis.set('hold:hong', 'không-phải-json', 'EX', 900);
    // `bookingId` không phải UUID: nếu lọt vào `WHERE id = ANY($1::uuid[])` thì Postgres trả `22P02` và
    // **cả** lượt đối chiếu bị bỏ; bản ghi này phải chỉ được đếm là không đọc được.
    await redis.set(
      'hold:khong-uuid',
      holdRecordJson({ bookingId: 'khong-phai-uuid', channelId: live.channelId, expiresAt: PAST }),
      'EX',
      900,
    );

    const session = createHoldProjectionSession(isolated);
    try {
      const report = await reconcileHoldProjection(testDb.db, session.store, { maxKeys: 100 });
      expect(report).toEqual({ scanned: 4, active: 3, repaired: 1, orphaned: 1, unreadable: 2 });
    } finally {
      await session.close();
    }

    const expiresAt = (await holdState(testDb.db, stale)).holdExpiresAt;
    const repaired = await readHoldRecord(redis, stale.bookingId);
    expect(repaired?.status).toBe('EXPIRED');
    expect(repaired?.releasedAt).toBe(expiresAt?.toISOString());
    // Ghi đè bằng `KEEPTTL`: đối chiếu không được kéo dài vòng đời của hold.
    expect(await redis.ttl(`hold:${stale.bookingId}`)).toBeGreaterThan(0);
    expect((await readHoldRecord(redis, live.bookingId))?.status).toBe('ACTIVE');
    expect((await readHoldRecord(redis, released.bookingId))?.status).toBe('RELEASED');
    expect(await redis.exists(`hold:${orphanId}`)).toBe(0);
    expect(await redis.get('hold:hong')).toBe('không-phải-json');
    expect(await redis.get('hold:khong-uuid')).not.toBeNull();
  }, 60_000);

  it('không có khoá nào ⇒ lượt đối chiếu rỗng, không chạm CSDL', async () => {
    const session = createHoldProjectionSession(isolated);
    try {
      expect(await reconcileHoldProjection(testDb.db, session.store, { maxKeys: 10 })).toEqual({
        scanned: 0,
        active: 0,
        repaired: 0,
        orphaned: 0,
        unreadable: 0,
      });
    } finally {
      await session.close();
    }
  });

  it('tôn trọng trần HOLD_RECONCILE_MAX_KEYS mỗi lượt', async () => {
    const first = await seedHold(testDb.db, { label: 'cap-1', expiresInSeconds: -60 });
    const second = await seedHold(testDb.db, { label: 'cap-2', expiresInSeconds: -60 });
    for (const fixture of [first, second])
      await redis.set(
        `hold:${fixture.bookingId}`,
        holdRecordJson({
          bookingId: fixture.bookingId,
          channelId: fixture.channelId,
          expiresAt: PAST,
        }),
        'EX',
        900,
      );

    const session = createHoldProjectionSession(isolated);
    try {
      const report = await reconcileHoldProjection(testDb.db, session.store, { maxKeys: 1 });
      expect(report.scanned).toBe(1);
      expect(report.repaired).toBeLessThanOrEqual(1);
    } finally {
      await session.close();
    }
  }, 60_000);

  it('handler ở chế độ RECONCILE nhả tồn rồi sửa projection và ghi dòng tổng kết', async () => {
    const fixture = await seedHold(testDb.db, { label: 'handler', expiresInSeconds: -120 });
    await redis.set(
      `hold:${fixture.bookingId}`,
      holdRecordJson({
        bookingId: fixture.bookingId,
        channelId: fixture.channelId,
        expiresAt: PAST,
      }),
      'EX',
      900,
    );
    const harness = makeHoldContext(testDb.db, testDb.ownerUrl, { REDIS_URL: isolated });

    await createHoldExpiryJob()({ mode: 'RECONCILE' }, harness.context);

    expect((await holdState(testDb.db, fixture)).status).toBe('EXPIRED');
    expect((await readHoldRecord(redis, fixture.bookingId))?.status).toBe('EXPIRED');
    expect(
      harness.logs.some((line) =>
        line.includes('đối chiếu Hold: đọc 1 bản ghi, 1 còn ACTIVE, sửa 1, xoá 0 mồ côi'),
      ),
    ).toBe(true);
  });
});
