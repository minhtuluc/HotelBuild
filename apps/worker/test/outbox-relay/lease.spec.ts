import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  claimDelivery,
  completeDelivery,
  failDelivery,
  relayOnce,
  type RelayOptions,
} from '../../src/jobs/outbox-relay/relay.js';
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
 * HB-130 AC2 — lease/CAS trên `event_deliveries`: đúng một delivery cho mỗi `(consumer, eventId)`, hai relay
 * chỉ một chủ tại một thời điểm, hết hạn lease thì lượt khác tiếp quản, và chủ cũ **không** ghi được kết quả
 * bằng token cũ. Lease nằm ở cột `lease_token` (uuid) + `lease_expires_at` (timestamptz); claim là một câu
 * `UPDATE` có điều kiện trên đúng khoá chính `(consumer, event_id)`.
 */
let h: OutboxTestDb;

const LEASE_SECONDS = 30;
const OPTIONS: RelayOptions = {
  batchSize: 50,
  leaseSeconds: LEASE_SECONDS,
  retryBaseSeconds: 30,
  retryMaxSeconds: 900,
  maxAttempts: 5,
};

beforeAll(async () => {
  h = await createOutboxTestDb('lease');
}, 120_000);

afterAll(async () => {
  await h?.close();
}, 60_000);

test('claim-takeover-and-stale-token', async () => {
  const clock = fakeClock('2026-11-05T00:00:00Z');
  const consumer = 'hb130-lease-holder';
  const eventId = await insertOutboxEvent(h.db, {});
  await insertDelivery(h.db, consumer, eventId);

  const tokenA = randomUUID();
  expect(await claimDelivery(h.db, consumer, eventId, tokenA, clock.now(), LEASE_SECONDS)).toBe(
    true,
  );
  const held = await deliveryRow(h.db, consumer, eventId);
  expect(held).toMatchObject({ status: 'PROCESSING', attempts: 0, lease_token: tokenA });
  expect(held.lease_expires_at?.toISOString()).toBe('2026-11-05T00:00:30.000Z');

  // Lượt thứ hai trong lúc lease còn hạn: CAS trả 0 hàng ⇒ không giành được.
  expect(
    await claimDelivery(h.db, consumer, eventId, randomUUID(), clock.now(), LEASE_SECONDS),
  ).toBe(false);
  // Token không phải chủ hàng cũng không hoàn tất được.
  expect(await completeDelivery(h.db, consumer, eventId, randomUUID(), clock.now())).toBe(false);

  // Hết hạn lease ⇒ lượt khác tiếp quản hàng.
  const tokenB = randomUUID();
  clock.advance((LEASE_SECONDS + 1) * 1000);
  expect(await claimDelivery(h.db, consumer, eventId, tokenB, clock.now(), LEASE_SECONDS)).toBe(
    true,
  );
  expect(await deliveryRow(h.db, consumer, eventId)).toMatchObject({
    status: 'PROCESSING',
    lease_token: tokenB,
  });

  // Worker cũ (tokenA) không ghi được hoàn tất, cũng không ghi được thất bại đè lên chủ mới.
  expect(await completeDelivery(h.db, consumer, eventId, tokenA, clock.now())).toBe(false);
  expect(
    await failDelivery(
      h.db,
      consumer,
      eventId,
      tokenA,
      clock.now(),
      1,
      'SYNTHETIC_CONSUMER_FAILURE',
      OPTIONS,
    ),
  ).toBeNull();
  expect(await deliveryRow(h.db, consumer, eventId)).toMatchObject({
    status: 'PROCESSING',
    lease_token: tokenB,
    attempts: 0,
  });

  // Chủ mới chốt được, hàng khoá đúng một lần.
  expect(await completeDelivery(h.db, consumer, eventId, tokenB, clock.now())).toBe(true);
  expect(await deliveryRow(h.db, consumer, eventId)).toMatchObject({
    status: 'COMPLETED',
    attempts: 1,
    lease_token: null,
    last_error: null,
  });
});

test('hai relay cùng giành một hàng chỉ một chủ thắng', async () => {
  const clock = fakeClock('2026-11-05T01:00:00Z');
  const consumer = 'hb130-lease-race';
  const eventId = await insertOutboxEvent(h.db, {});
  await insertDelivery(h.db, consumer, eventId);

  const attempts = await Promise.all([
    claimDelivery(h.db, consumer, eventId, randomUUID(), clock.now(), LEASE_SECONDS),
    claimDelivery(h.db, consumer, eventId, randomUUID(), clock.now(), LEASE_SECONDS),
  ]);
  expect(attempts.filter((claimed) => claimed)).toHaveLength(1);
  expect(await deliveryRow(h.db, consumer, eventId)).toMatchObject({ status: 'PROCESSING' });
});

test('một delivery cho mỗi (consumer,eventId); hai consumer mỗi bên nhận đủ', async () => {
  const clock = fakeClock('2026-11-05T02:00:00Z');
  const { context } = makeContext(h.db, clock, h.ownerUrl);
  // Loại sự kiện riêng của ca này để số đếm không lẫn sự kiện của các ca trước trong cùng CSDL.
  const inventoryType = 'HB130DedupInventoryChanged';
  const rateType = 'HB130DedupRateChanged';
  const a = recordingConsumer(h.db, 'hb130-dedup-a', { eventTypes: [inventoryType] });
  const b = recordingConsumer(h.db, 'hb130-dedup-b', { eventTypes: [inventoryType, rateType] });
  const consumers = [a.consumer, b.consumer];
  const inventory = await insertOutboxEvent(h.db, { eventType: inventoryType });
  const rate = await insertOutboxEvent(h.db, { eventType: rateType });
  const unrouted = await insertOutboxEvent(h.db, { eventType: 'HB130DedupHoldExpired' });

  const first = await relayOnce(context, consumers, OPTIONS);
  // Số đếm tổng hợp có thể gồm sự kiện do ca trước để lại trong cùng CSDL (chốt `PUBLISHED` ở lượt quét
  // này); phần khẳng định theo từng sự kiện bên dưới mới là điều được kiểm.
  expect(first).toMatchObject({ registered: 3, claimed: 3, completed: 3 });

  // Phát lại: không đăng ký thêm, không gọi thêm consumer, không thêm tác dụng.
  const callsAfterFirst = a.calls.length + b.calls.length;
  const second = await relayOnce(context, consumers, OPTIONS);
  expect(second).toMatchObject({ registered: 0, completed: 0, claimed: 0 });
  expect(a.calls.length + b.calls.length).toBe(callsAfterFirst);

  const deliveriesOf = async (eventId: string) =>
    h.rows('SELECT consumer FROM event_deliveries WHERE event_id = $1::uuid ORDER BY consumer', [
      eventId,
    ]);
  expect((await deliveriesOf(inventory)).map((row) => row['consumer'])).toEqual([
    'hb130-dedup-a',
    'hb130-dedup-b',
  ]);
  expect(await deliveriesOf(rate)).toEqual([{ consumer: 'hb130-dedup-b' }]);
  expect(await deliveriesOf(unrouted)).toEqual([]);

  const effectsOf = async (eventId: string) =>
    h.rows('SELECT count(*)::int AS n FROM hb130_effects WHERE event_id = $1::uuid', [eventId]);
  expect(await effectsOf(inventory)).toEqual([{ n: 2 }]);
  expect(await effectsOf(rate)).toEqual([{ n: 1 }]);

  const statusOf = async (eventId: string) =>
    (await h.rows('SELECT status FROM outbox_events WHERE id = $1::uuid', [eventId]))[0];
  // Sự kiện không consumer nào nhận vẫn PENDING: relay không tự nhận đã vận chuyển hộ ai.
  expect(await statusOf(unrouted)).toEqual({ status: 'PENDING' });
  expect(await statusOf(inventory)).toEqual({ status: 'PUBLISHED' });
  expect(await statusOf(rate)).toEqual({ status: 'PUBLISHED' });
});
