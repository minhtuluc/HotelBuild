import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents } from 'bullmq';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { bullmqConstructors, createBullmqDeps, redisOptions } from '../../src/bullmq.factory.js';
import { OutboxConsumerError, type OutboxConsumer } from '../../src/jobs/outbox-relay/consumer.js';
import { createOutboxRelayJob } from '../../src/jobs/outbox-relay/outbox-relay.job.js';
import {
  OUTBOX_QUEUE,
  claimDelivery,
  relayOnce,
  retryDelaySeconds,
  type RelayOptions,
} from '../../src/jobs/outbox-relay/relay.js';
import { JOB_HANDLERS } from '../../src/jobs/registry.js';
import {
  createOutboxTestDb,
  deliveryRow,
  fakeClock,
  insertDelivery,
  insertOutboxEvent,
  makeContext,
  recordingConsumer,
  type OutboxTestDb,
} from './harness.js';

/**
 * HB-130 AC3/AC6/AC10 — tiến trình chết ở mọi ranh giới vận chuyển không mất sự kiện; Redis mất job không
 * mất việc (trạng thái nằm ở PostgreSQL); sự kiện đi qua trong ≤ 5 phút và lỗi của consumer này không kéo
 * theo consumer khác hay ghi vào bảng nghiệp vụ.
 */
let h: OutboxTestDb;

const OPTIONS: RelayOptions = {
  batchSize: 50,
  leaseSeconds: 30,
  retryBaseSeconds: 30,
  retryMaxSeconds: 900,
  maxAttempts: 5,
};
const redisUrl = process.env.REDIS_URL;
const quietLogger = { info: () => {}, error: () => {} };
const FIVE_MINUTES_MS = 5 * 60 * 1000;

beforeAll(async () => {
  h = await createOutboxTestDb('recovery');
}, 120_000);

afterAll(async () => {
  await h?.close();
}, 60_000);

async function effectCount(consumer: string, eventId: string): Promise<number> {
  const rows = await h.rows(
    'SELECT count(*)::int AS n FROM hb130_effects WHERE consumer = $1 AND event_id = $2::uuid',
    [consumer, eventId],
  );
  return Number(rows[0]?.['n'] ?? 0);
}

async function businessCounts(): Promise<Record<string, unknown>[]> {
  return h.rows(
    `SELECT (SELECT count(*)::int FROM bookings) AS bookings,
            (SELECT count(*)::int FROM room_moves) AS room_moves`,
  );
}

test('crash-at-publish-boundaries', async () => {
  const clock = fakeClock('2026-11-05T00:00:00Z');
  const { context } = makeContext(h.db, clock, h.ownerUrl);

  // (a) Chết trước khi vận chuyển: giành lease rồi tiến trình biến mất, không chốt gì.
  const abandonedConsumer = 'hb130-crash-before-publish';
  const abandonedEvent = await insertOutboxEvent(h.db, {});
  await insertDelivery(h.db, abandonedConsumer, abandonedEvent);
  expect(
    await claimDelivery(
      h.db,
      abandonedConsumer,
      abandonedEvent,
      randomUUID(),
      clock.now(),
      OPTIONS.leaseSeconds,
    ),
  ).toBe(true);
  const other = recordingConsumer(h.db, abandonedConsumer);
  // Trong lúc lease còn hạn, lượt kế tiếp không giành được: hàng chờ hết lease, không mất sự kiện.
  const early = await relayOnce(context, [other.consumer], OPTIONS);
  expect(early).toMatchObject({ claimed: 0, completed: 0, published: 0, registered: 0 });
  expect(await deliveryRow(h.db, abandonedConsumer, abandonedEvent)).toMatchObject({
    status: 'PROCESSING',
  });
  clock.advance((OPTIONS.leaseSeconds + 1) * 1000);
  const takeover = await relayOnce(context, [other.consumer], OPTIONS);
  expect(takeover).toMatchObject({ claimed: 1, completed: 1, published: 1 });
  expect(await effectCount(abandonedConsumer, abandonedEvent)).toBe(1);

  // (b) Chết sau khi đã gây tác dụng nhưng trước khi chốt completion.
  const afterPublish = recordingConsumer(h.db, 'hb130-crash-after-publish', { failFirst: 1 });
  const publishedEvent = await insertOutboxEvent(h.db, {});
  const firstAttempt = await relayOnce(context, [afterPublish.consumer], OPTIONS);
  expect(firstAttempt).toMatchObject({ claimed: 1, retried: 1, completed: 0, published: 0 });
  // Tác dụng đã có thật, nhưng hàng chưa COMPLETED — không suy ra hoàn tất từ việc đã gọi consumer.
  expect(await effectCount('hb130-crash-after-publish', publishedEvent)).toBe(1);
  expect(await deliveryRow(h.db, 'hb130-crash-after-publish', publishedEvent)).toMatchObject({
    status: 'PENDING',
    attempts: 1,
  });
  // Chưa tới mốc backoff (theo clock + cấu hình) thì không thử lại.
  const beforeBackoff = await relayOnce(context, [afterPublish.consumer], OPTIONS);
  expect(beforeBackoff).toMatchObject({ claimed: 0, retried: 0, completed: 0 });
  clock.advance(retryDelaySeconds(1, OPTIONS) * 1000);
  const replay = await relayOnce(context, [afterPublish.consumer], OPTIONS);
  expect(replay).toMatchObject({ claimed: 1, completed: 1, published: 1 });
  expect(afterPublish.calls).toHaveLength(2);
  // Phát lại cùng sự kiện vẫn đúng **một** tác dụng.
  expect(await effectCount('hb130-crash-after-publish', publishedEvent)).toBe(1);
  expect(await deliveryRow(h.db, 'hb130-crash-after-publish', publishedEvent)).toMatchObject({
    status: 'COMPLETED',
    attempts: 2,
  });
});

test('five-minute-delivery-and-consumer-isolation', async () => {
  const clock = fakeClock('2026-11-05T04:00:00Z');
  const { context, logs } = makeContext(h.db, clock, h.ownerUrl);
  const sync = recordingConsumer(h.db, 'hb130-five-min-sync');
  const createdAt = new Date('2026-11-05T03:56:00Z');
  const cleanEvent = await insertOutboxEvent(h.db, { createdAt, availableAt: createdAt });

  // Không lỗi: sự kiện tạo lúc T−4 phút được vận chuyển xong trong ≤ 5 phút.
  const cleanReport = await relayOnce(context, [sync.consumer], OPTIONS);
  expect(cleanReport).toMatchObject({ completed: 1, published: 1 });
  expect(sync.calls).toHaveLength(1);
  expect(sync.calls.at(0)?.occurredAt.getTime()).toBe(createdAt.getTime());
  const cleanRow = await deliveryRow(h.db, 'hb130-five-min-sync', cleanEvent);
  const completedAt = cleanRow.completed_at?.getTime();
  expect(completedAt).toBeTypeOf('number');
  expect((completedAt ?? 0) - createdAt.getTime()).toBeLessThanOrEqual(FIVE_MINUTES_MS);

  // Consumer thông báo hỏng không được kéo theo consumer khác, không đụng bảng nghiệp vụ.
  const notiFailure: OutboxConsumer = {
    name: 'hb130-noti-consumer',
    version: 1,
    accepts: (eventType) => eventType === 'InventoryChanged',
    handle: async () => {
      throw new OutboxConsumerError('NOTI_PROVIDER_UNAVAILABLE');
    },
  };
  const failingEvent = await insertOutboxEvent(h.db, {
    eventType: 'InventoryChanged',
    createdAt,
    payload: { schemaVersion: 1, guestPhone: 'PII-SECRET-0905123456' },
  });
  const businessBefore = await businessCounts();

  for (let attempt = 1; attempt <= OPTIONS.maxAttempts; attempt += 1) {
    const report = await relayOnce(context, [sync.consumer, notiFailure], OPTIONS);
    const notiRow = await deliveryRow(h.db, 'hb130-noti-consumer', failingEvent);
    expect(notiRow.attempts).toBe(attempt);
    if (attempt < OPTIONS.maxAttempts) {
      expect(notiRow.status).toBe('PENDING');
      expect(report.retried).toBe(1);
      clock.advance(retryDelaySeconds(attempt, OPTIONS) * 1000);
    } else {
      expect(notiRow.status).toBe('DEAD_LETTER');
      expect(notiRow.last_error).toBe('NOTI_PROVIDER_UNAVAILABLE');
      expect(report.deadLettered).toBe(1);
    }
  }
  // Lỗi consumer thông báo không nhân bản tác dụng, không xoá delivery consumer còn lại.
  expect(await effectCount('hb130-noti-consumer', failingEvent)).toBe(0);
  expect(await effectCount('hb130-five-min-sync', failingEvent)).toBe(1);
  expect(await deliveryRow(h.db, 'hb130-five-min-sync', failingEvent)).toMatchObject({
    status: 'COMPLETED',
    attempts: 1,
  });
  expect(await businessCounts()).toEqual(businessBefore);
  // Sự kiện còn consumer chết thì không mang dấu PUBLISHED, payload giữ nguyên.
  const eventRow = await h.rows(
    'SELECT status, payload_json FROM outbox_events WHERE id = $1::uuid',
    [failingEvent],
  );
  expect(eventRow[0]?.['status']).toBe('DEAD_LETTER');
  expect(eventRow[0]?.['payload_json']).toMatchObject({
    schemaVersion: 1,
    guestPhone: 'PII-SECRET-0905123456',
  });
  expect(logs.join('\n')).not.toContain('PII-SECRET');
  expect(logs.join('\n')).toContain('NOTI_PROVIDER_UNAVAILABLE');
});

test.skipIf(!redisUrl)('redis-loss-after-published', async () => {
  if (!redisUrl) throw new Error('cần REDIS_URL');
  const clock = fakeClock('2026-11-05T05:00:00Z');
  const consumerName = 'hb130-redis-loss';
  const recorder = recordingConsumer(h.db, consumerName);
  const { context } = makeContext(h.db, clock, h.ownerUrl);
  const eventId = await insertOutboxEvent(h.db, {});
  await insertDelivery(h.db, consumerName, eventId);
  // Outbox đã mang dấu vận chuyển (đối soát tay/chốt nhầm) mà delivery vẫn PENDING: relay phải tiếp tục từ
  // PostgreSQL, **không** suy ra completed từ dấu PUBLISHED.
  await h.db.$executeRaw`
    UPDATE outbox_events SET status = 'PUBLISHED', processed_at = ${clock.now()}
     WHERE id = ${eventId}::uuid`;

  const connection = redisOptions(redisUrl);
  const queue = new Queue(OUTBOX_QUEUE, { connection });
  const events = new QueueEvents(OUTBOX_QUEUE, { connection });
  const deps = createBullmqDeps(context.config, quietLogger, bullmqConstructors(quietLogger), {
    handlers: { [OUTBOX_QUEUE]: createOutboxRelayJob([recorder.consumer]) },
    context,
  });
  try {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await events.waitUntilReady();
    // Job mất khỏi Redis trước khi ai xử lý.
    await queue.add('relay', {});
    await queue.obliterate({ force: true });
    expect(await queue.getJobCounts('waiting', 'active', 'delayed')).toMatchObject({
      waiting: 0,
      active: 0,
      delayed: 0,
    });
    expect(await deliveryRow(h.db, consumerName, eventId)).toMatchObject({ status: 'PENDING' });
    expect(recorder.calls.filter((envelope) => envelope.eventId === eventId)).toHaveLength(0);

    // Lượt relay sau (qua BullMQ thật + dây nối thật) chạy lại từ CSDL và vận chuyển nốt.
    const worker = deps.createWorker(OUTBOX_QUEUE, async () => {
      throw new Error('handler mặc định không được dùng khi đã nối handler thật');
    });
    try {
      const next = await queue.add('relay', {});
      await next.waitUntilFinished(events, 20_000);
    } finally {
      await worker.close();
    }
    expect(recorder.calls.filter((envelope) => envelope.eventId === eventId)).toHaveLength(1);
    expect(await deliveryRow(h.db, consumerName, eventId)).toMatchObject({
      status: 'COMPLETED',
      attempts: 1,
    });
    expect(await effectCount(consumerName, eventId)).toBe(1);
  } finally {
    await events.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  }
});

test('hàng đợi relay đã nối handler thật trong sổ đăng ký', () => {
  expect(JOB_HANDLERS[OUTBOX_QUEUE]).toBeTypeOf('function');
});
