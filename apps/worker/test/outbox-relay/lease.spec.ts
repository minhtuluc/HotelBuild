import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  claimDelivery,
  completeDelivery,
  failDelivery,
  relayOnce,
  type RelayOptions,
} from '../../src/jobs/outbox-relay/relay.js';
import { OutboxConsumerError, type OutboxConsumer } from '../../src/jobs/outbox-relay/consumer.js';
import {
  FIXTURE_FAILURE_CODE,
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
 * chỉ một chủ tại một thời điểm, hết hạn lease thì lượt khác tiếp quản, chủ cũ **không** ghi được kết quả
 * bằng token cũ. Lease nằm ở cột `lease_token` (uuid) + `lease_expires_at` (timestamptz); claim là một câu
 * `UPDATE` có điều kiện trên đúng khoá chính `(consumer, event_id)` và **tăng `attempts` tại chỗ**.
 *
 * Ca cuối là hồi quy cho lỗi P2 "lô đăng ký bị sự kiện không-consumer lấp đầy": bộ lọc theo loại nằm trong
 * truy vấn nên sự kiện có consumer không bị đói.
 */
let h: OutboxTestDb;

const OPTIONS: RelayOptions = {
  batchSize: 50,
  leaseSeconds: 30,
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

async function claimOrFail(consumer: string, eventId: string, now: Date) {
  const claim = await claimDelivery(h.db, consumer, eventId, now, OPTIONS);
  if (claim === null) throw new Error(`${consumer}: phải giành được hàng nhưng CAS trả null`);
  return claim;
}

test('claim-takeover-and-stale-token', async () => {
  const clock = fakeClock('2026-11-05T00:00:00Z');
  const consumer = 'hb130-lease-holder';
  const eventId = await insertOutboxEvent(h.db, { eventType: 'HB130LeaseTakeover' });
  await insertDelivery(h.db, consumer, eventId);

  // Lượt đầu tiêu một lượt vận chuyển ngay khi giành (attempts 0 → 1).
  const first = await claimOrFail(consumer, eventId, clock.now());
  expect(first.attempt).toBe(1);
  const held = await deliveryRow(h.db, consumer, eventId);
  expect(held).toMatchObject({ status: 'PROCESSING', attempts: 1, lease_token: first.token });
  expect(held.lease_expires_at?.toISOString()).toBe('2026-11-05T00:00:30.000Z');

  // Lượt thứ hai trong lúc lease còn hạn: CAS trả null ⇒ không giành được.
  expect(await claimDelivery(h.db, consumer, eventId, clock.now(), OPTIONS)).toBeNull();
  // Token không phải chủ hàng cũng không hoàn tất được.
  expect(await completeDelivery(h.db, consumer, eventId, randomUUID(), clock.now())).toBe(false);

  // Hết hạn lease ⇒ lượt khác tiếp quản hàng; lượt bị bỏ dở đã tiêu một lượt nên lượt này là lượt 2.
  clock.advance((OPTIONS.leaseSeconds + 1) * 1000);
  const takeover = await claimOrFail(consumer, eventId, clock.now());
  expect(takeover.attempt).toBe(2);
  expect(await deliveryRow(h.db, consumer, eventId)).toMatchObject({
    status: 'PROCESSING',
    attempts: 2,
    lease_token: takeover.token,
  });

  // Worker cũ (token cũ) không ghi được hoàn tất, cũng không ghi được thất bại đè lên chủ mới.
  expect(await completeDelivery(h.db, consumer, eventId, first.token, clock.now())).toBe(false);
  expect(
    await failDelivery(
      h.db,
      consumer,
      eventId,
      first.token,
      clock.now(),
      1,
      FIXTURE_FAILURE_CODE,
      OPTIONS,
    ),
  ).toBeNull();
  expect(await deliveryRow(h.db, consumer, eventId)).toMatchObject({
    status: 'PROCESSING',
    lease_token: takeover.token,
    attempts: 2,
    last_error: null,
  });

  // Chủ mới chốt được; completion **không** cộng thêm lượt (attempts chỉ tăng lúc giành).
  expect(await completeDelivery(h.db, consumer, eventId, takeover.token, clock.now())).toBe(true);
  expect(await deliveryRow(h.db, consumer, eventId)).toMatchObject({
    status: 'COMPLETED',
    attempts: 2,
    lease_token: null,
    last_error: null,
  });
});

test('hai relay cùng giành một hàng chỉ một chủ thắng', async () => {
  const clock = fakeClock('2026-11-05T01:00:00Z');
  const consumer = 'hb130-lease-race';
  const eventId = await insertOutboxEvent(h.db, { eventType: 'HB130LeaseRace' });
  await insertDelivery(h.db, consumer, eventId);

  const claims = await Promise.all([
    claimDelivery(h.db, consumer, eventId, clock.now(), OPTIONS),
    claimDelivery(h.db, consumer, eventId, clock.now(), OPTIONS),
  ]);
  const winners = claims.filter((claim) => claim !== null);
  expect(winners).toHaveLength(1);
  expect(winners[0]?.attempt).toBe(1);
  expect(await deliveryRow(h.db, consumer, eventId)).toMatchObject({
    status: 'PROCESSING',
    attempts: 1,
  });
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

test('lượt bị tiếp quản giữa chừng không chốt được kết quả bằng token cũ', async () => {
  const clock = fakeClock('2026-11-05T04:00:00Z');
  const { context } = makeContext(h.db, clock, h.ownerUrl);
  const name = 'hb130-stale-settle';
  const eventType = 'HB130StaleSettle';
  const eventId = await insertOutboxEvent(h.db, { eventType });
  await insertDelivery(h.db, name, eventId);

  // Handler "chậm": trước khi trả về, để một relay khác (đóng vai chủ mới) tiếp quản chính hàng này.
  const consumer: OutboxConsumer = {
    name,
    version: 1,
    eventTypes: [eventType],
    handle: async () => {
      clock.advance((OPTIONS.leaseSeconds + 1) * 1000);
      const takeover = await claimDelivery(h.db, name, eventId, clock.now(), OPTIONS);
      expect(takeover?.attempt).toBe(2);
    },
  };

  const report = await relayOnce(context, [consumer], OPTIONS);
  // Relay cũ **không** ghi được completion; hàng vẫn thuộc chủ mới, không bị đánh dấu hoàn tất.
  expect(report).toMatchObject({ claimed: 1, completed: 0, stale: 1 });
  const row = await deliveryRow(h.db, name, eventId);
  expect(row).toMatchObject({ status: 'PROCESSING', attempts: 2, last_error: null });
  expect(row.completed_at).toBeNull();
  expect(row.lease_token).not.toBeNull();
});

test('lỗi sau khi bị tiếp quản không ghi đè chủ mới', async () => {
  const clock = fakeClock('2026-11-05T05:00:00Z');
  const { context } = makeContext(h.db, clock, h.ownerUrl);
  const name = 'hb130-stale-failure';
  const eventType = 'HB130StaleFailure';
  const eventId = await insertOutboxEvent(h.db, { eventType });
  await insertDelivery(h.db, name, eventId);

  const consumer: OutboxConsumer = {
    name,
    version: 1,
    eventTypes: [eventType],
    handle: async () => {
      clock.advance((OPTIONS.leaseSeconds + 1) * 1000);
      await claimDelivery(h.db, name, eventId, clock.now(), OPTIONS);
      throw new OutboxConsumerError(FIXTURE_FAILURE_CODE);
    },
  };

  const report = await relayOnce(context, [consumer], OPTIONS);
  // Không đếm thành thử lại/dead letter của lượt cũ: chủ mới giữ nguyên dấu vết.
  expect(report).toMatchObject({ claimed: 1, retried: 0, deadLettered: 0, stale: 1 });
  expect(await deliveryRow(h.db, name, eventId)).toMatchObject({
    status: 'PROCESSING',
    attempts: 2,
    last_error: null,
  });
});

// HB-200: trần tường minh 30 giây vì ca ghi 65 sự kiện (60 không-consumer + 5 có consumer) xuống
// PostgreSQL thật rồi chạy 4 lượt relay — mặc định 5 giây của vitest chỉ đủ khi máy rảnh.
test('lô đầy sự kiện không-consumer không làm đói sự kiện có consumer', async () => {
  const clock = fakeClock('2026-11-05T03:00:00Z');
  const { context } = makeContext(h.db, clock, h.ownerUrl);
  const consumer = recordingConsumer(h.db, 'hb130-starvation', {
    eventTypes: ['HB130StarveRoutable'],
  });
  const batch: RelayOptions = { ...OPTIONS, batchSize: 50 };
  const unroutableType = 'HB130StarveUnroutable';
  const older = new Date(clock.now().getTime() - 60_000);
  for (let index = 0; index < 60; index += 1) {
    await insertOutboxEvent(h.db, { eventType: unroutableType, createdAt: older });
  }
  const routable: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    routable.push(await insertOutboxEvent(h.db, { eventType: 'HB130StarveRoutable' }));
  }

  // Bộ lọc loại nằm trong truy vấn nên 5 sự kiện có consumer được vận chuyển ngay lượt này, không phải chờ
  // 60 sự kiện không ai nhận (chúng không chiếm lô đăng ký).
  const first = await relayOnce(context, [consumer.consumer], batch);
  expect(first).toMatchObject({ registered: 5, claimed: 5, completed: 5 });
  for (const id of routable) {
    expect(await deliveryRow(h.db, 'hb130-starvation', id)).toMatchObject({ status: 'COMPLETED' });
  }
  // 60 sự kiện kia vẫn PENDING, **không** có delivery nào: chưa ai nhận thì relay không tự đánh dấu.
  expect(
    await h.rows(
      `SELECT count(*)::int AS pending,
              (SELECT count(*)::int FROM event_deliveries d JOIN outbox_events e ON e.id = d.event_id
                WHERE e.event_type = $1) AS deliveries
         FROM outbox_events WHERE event_type = $1 AND status = 'PENDING'`,
      [unroutableType],
    ),
  ).toEqual([{ pending: 60, deliveries: 0 }]);
  const second = await relayOnce(context, [consumer.consumer], batch);
  expect(second).toMatchObject({ claimed: 0, completed: 0 });

  // Consumer mới đăng ký đúng loại đó thì nhặt được hết (không bị bỏ hẳn), theo lô 50 rồi 10.
  const late = recordingConsumer(h.db, 'hb130-late', { eventTypes: [unroutableType] });
  const third = await relayOnce(context, [consumer.consumer, late.consumer], batch);
  expect(third).toMatchObject({ registered: 50, completed: 50 });
  const fourth = await relayOnce(context, [consumer.consumer, late.consumer], batch);
  expect(fourth).toMatchObject({ registered: 10, completed: 10 });
  expect(
    await h.rows('SELECT status FROM outbox_events WHERE event_type = $1 LIMIT 1', [
      unroutableType,
    ]),
  ).toEqual([{ status: 'PUBLISHED' }]);
}, 30_000);
