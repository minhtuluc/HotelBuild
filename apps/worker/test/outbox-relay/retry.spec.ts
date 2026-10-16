import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  relayOnce,
  retryDelaySeconds,
  type RelayOptions,
} from '../../src/jobs/outbox-relay/relay.js';
import {
  createOutboxTestDb,
  deliveryRow,
  fakeClock,
  insertOutboxEvent,
  makeContext,
  recordingConsumer,
  type OutboxTestDb,
} from './harness.js';

/**
 * HB-130 AC7 — đúng **5** lượt vận chuyển thất bại thì vào `DEAD_LETTER` bền, giữ payload, `last_error` đã
 * che (không PII), backoff theo clock + cấu hình, và lượt quét sau không giành lại hàng đã chết.
 * Ngưỡng 5 là BR-CHAN-07 (khác ngưỡng 3 lỗi sync liên tiếp của HB-131).
 */
let h: OutboxTestDb;

const OPTIONS: RelayOptions = {
  batchSize: 50,
  leaseSeconds: 30,
  retryBaseSeconds: 30,
  retryMaxSeconds: 900,
  maxAttempts: 5,
};
const CONSUMER = 'hb130-retry-dead-letter';

beforeAll(async () => {
  h = await createOutboxTestDb('retry');
}, 120_000);

afterAll(async () => {
  await h?.close();
}, 60_000);

test('fifth-failure-dead-letter', async () => {
  const clock = fakeClock('2026-11-05T06:00:00Z');
  const { context, logs } = makeContext(h.db, clock, h.ownerUrl);
  // Lỗi **thô** mang PII: mã lưu bền phải được che, không lấy `message` của lỗi.
  const consumer = recordingConsumer(h.db, CONSUMER, { failFirst: 99, rawError: true });
  const payload = {
    schemaVersion: 2,
    version: '7',
    guestName: 'PII-SECRET-nguyen-van-a',
    phone: '0905123456',
  };
  const eventId = await insertOutboxEvent(h.db, {
    payload,
    createdAt: clock.now(),
    availableAt: clock.now(),
  });

  for (let attempt = 1; attempt <= OPTIONS.maxAttempts; attempt += 1) {
    const report = await relayOnce(context, [consumer.consumer], OPTIONS);
    expect(report.claimed).toBe(1);
    const row = await deliveryRow(h.db, CONSUMER, eventId);
    expect(row.attempts).toBe(attempt);
    if (attempt < OPTIONS.maxAttempts) {
      expect(report.retried).toBe(1);
      expect(row.status).toBe('PENDING');
      // Mốc thử lại = clock hiện tại + backoff(base × 2^(attempt−1)); trước mốc đó lượt quét không giành hàng.
      expect((row.lease_expires_at?.getTime() ?? 0) - clock.now().getTime()).toBe(
        retryDelaySeconds(attempt, OPTIONS) * 1000,
      );
      expect(row.last_error).toBe('CONSUMER_HANDLER_FAILED');
      const tooEarly = await relayOnce(context, [consumer.consumer], OPTIONS);
      expect(tooEarly).toMatchObject({ claimed: 0, retried: 0, completed: 0 });
      clock.advance(retryDelaySeconds(attempt, OPTIONS) * 1000);
      continue;
    }
    expect(report.deadLettered).toBe(1);
    expect(row).toMatchObject({
      status: 'DEAD_LETTER',
      attempts: OPTIONS.maxAttempts,
      last_error: 'CONSUMER_HANDLER_FAILED',
      lease_token: null,
      lease_expires_at: null,
    });
  }

  // Hàng chết không được giành lại; payload còn nguyên để vận hành đối soát/requeue có kiểm soát.
  const after = await relayOnce(context, [consumer.consumer], OPTIONS);
  expect(after).toMatchObject({ claimed: 0, retried: 0, deadLettered: 0 });
  const eventRow = await h.rows(
    'SELECT status, attempts, payload_json FROM outbox_events WHERE id = $1::uuid',
    [eventId],
  );
  expect(eventRow[0]).toMatchObject({ status: 'DEAD_LETTER', attempts: OPTIONS.maxAttempts });
  expect(eventRow[0]?.['payload_json']).toEqual(payload);

  // At-least-once: 5 lượt gọi handler, nhưng đúng **một** tác dụng nhờ dedup của consumer.
  expect(consumer.calls).toHaveLength(OPTIONS.maxAttempts);
  expect(
    await h.rows(
      'SELECT count(*)::int AS n FROM hb130_effects WHERE consumer = $1 AND event_id = $2::uuid',
      [CONSUMER, eventId],
    ),
  ).toEqual([{ n: 1 }]);

  // Log ổn định, không PII/bí mật/địa chỉ nhận.
  const logged = logs.join('\n');
  expect(logged).toContain('CONSUMER_HANDLER_FAILED');
  expect(logged).toContain('dead letter');
  for (const leaked of ['PII-SECRET', '0905123456', 'secret-abc', 'nguyen-van-a'])
    expect(logged).not.toContain(leaked);
});
