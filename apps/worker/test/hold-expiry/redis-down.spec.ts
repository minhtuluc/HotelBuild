import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHoldExpiryJob } from '../../src/jobs/hold-expiry/hold-expiry.job.js';
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
import { redisProxy } from '../redis-proxy.js';
import type { RedisProxy } from '../redis-proxy.js';

/**
 * HB-078 AC4 — **Redis tắt giữa chừng**: hold vẫn được nhả đúng hạn (nguồn chân lý là
 * `bookings.hold_expires_at`, Redis chỉ là bộ đếm nhanh) và khi Redis sống lại, lượt đối chiếu sửa
 * projection. Cùng lúc đó lỗi Redis phải đi vào log bằng **mã an toàn**, không message thô (TD-01).
 *
 * Cắt đường bằng `redisProxy` của bộ test (không dừng Redis thật của máy): phiên của worker trỏ vào proxy,
 * còn client đọc/ghi trực tiếp trong test đi thẳng tới Redis nên vẫn kiểm được trạng thái projection.
 */
const redisUrl = process.env.REDIS_URL ?? '';
if (redisUrl === '')
  process.stderr.write('[skip] HB-078 AC4 cần REDIS_URL để kiểm Redis tắt giữa chừng.\n');

const PAST = new Date('2026-10-18T00:00:00.000Z').toISOString();
const FUTURE = new Date('2026-10-19T00:00:00.000Z').toISOString();

describe.skipIf(redisUrl === '')('HB-078 — Redis tắt giữa chừng', () => {
  let testDb: HoldTestDb;
  let redis: Redis;
  let isolated = '';
  let proxy: RedisProxy;
  const keys: string[] = [];

  beforeAll(async () => {
    testDb = await createHoldTestDb('redis-down');
    // DB lệch một đơn vị so với file đối chiếu: hai file chạy song song không nhìn thấy khoá của nhau.
    isolated = redisUrlOffsetBy(redisUrl, 1);
    redis = new Redis(isolated);
    proxy = await redisProxy(isolated);
  }, 120_000);

  afterAll(async () => {
    if (keys.length > 0) await redis.del(...keys);
    await proxy.close();
    await redis.quit();
    await testDb.close();
  }, 30_000);

  it('Redis chết giữa chừng: hold quá hạn vẫn được nhả; Redis sống lại: projection được sửa', async () => {
    const due = await seedHold(testDb.db, { label: 'due', expiresInSeconds: -120 });
    const live = await seedHold(testDb.db, { label: 'live', expiresInSeconds: 3600 });
    for (const [fixture, expiresAt] of [
      [due, PAST],
      [live, FUTURE],
    ] as const) {
      const key = `hold:${fixture.bookingId}`;
      keys.push(key);
      await redis.set(
        key,
        holdRecordJson({ bookingId: fixture.bookingId, channelId: fixture.channelId, expiresAt }),
        'EX',
        900,
      );
    }

    const harness = makeHoldContext(testDb.db, testDb.ownerUrl, { REDIS_URL: proxy.url });
    const handler = createHoldExpiryJob();
    await proxy.cut();

    await expect(handler({ mode: 'RECONCILE' }, harness.context)).resolves.toBeUndefined();

    // Redis không phải điều kiện chạy: hold quá hạn vẫn được nhả, hold còn hạn vẫn nguyên.
    expect((await holdState(testDb.db, due)).status).toBe('EXPIRED');
    expect((await holdState(testDb.db, due)).releasedAssignments).toBe(1);
    expect((await holdState(testDb.db, live)).status).toBe('HELD');
    // Lỗi chỉ đi vào log dưới dạng mã an toàn, không có message thô của ioredis.
    const failure = harness.logs.find((line) => line.startsWith('error|')) ?? '';
    expect(failure).toMatch(
      /đối chiếu Hold lỗi \(mã (ECONNREFUSED|ECONNRESET|UNKNOWN|E_REDIS_UNREACHABLE)\)/,
    );
    expect(harness.logs.join('\n')).not.toContain('Stream isn');
    expect((await readHoldRecord(redis, due.bookingId))?.status).toBe('ACTIVE');

    await proxy.restore();
    await expect(handler({ mode: 'RECONCILE' }, harness.context)).resolves.toBeUndefined();

    expect((await readHoldRecord(redis, due.bookingId))?.status).toBe('EXPIRED');
    expect((await readHoldRecord(redis, live.bookingId))?.status).toBe('ACTIVE');
    // Không chốt đếm tuyệt đối (khoá `hold:*` của các file test khác trong cùng cụm Redis có thể lẫn vào
    // giữa SCAN và lượt quét, làm số đọc thay đổi). Tác dụng cốt lõi của HB-078 được khẳng định:
    // lượt đối chiếu *có* sửa projection (nhả đúng 1 hold quá hạn như thiết kế).
    const reconcileLogs = harness.logs.filter((line) => line.includes('đối chiếu Hold: đọc'));
    expect(reconcileLogs.length).toBeGreaterThan(0);
    expect(reconcileLogs.some((line) => line.includes('sửa 1, xoá'))).toBe(true);
  }, 90_000);
});
