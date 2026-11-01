/**
 * HB-131 — test khoá giai đoạn A cho nhịp `q.channel-sync`: quét mỗi **300 giây** theo
 * `SystemSetting.job.channelSync.intervalSeconds`, đăng ký repeat không trùng qua restart, đổi cấu hình
 * đổi nhịp; consumer gửi ảnh tồn mới nhất (version) và phục hồi delivery bền khi Redis/lease mất.
 *
 * Đỏ dự kiến hiện tại: `q.channel-sync` chưa nằm trong `REPEATABLE_QUEUES`/chưa có handler nên không có
 * scheduler, không có request tới simulator OTA.
 */
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { isRepeatableQueue, QUEUE_NAMES } from '../../src/queues.js';
import { repeatSchedules } from '../../src/worker-app.js';
import {
  CHANNEL_SYNC_QUEUE,
  config,
  rows,
  runSweep,
  schedulers,
  seed,
  setup,
  simulatorRequests,
  simulatorRespond,
  snapshotBodies,
  startWorker,
  stopWorker,
  teardown,
} from './harness.js';

// Migration + Postgres + BullMQ mất vài giây mỗi tệp; ngưỡng mặc định 5 giây quá ngắn.
vi.setConfig({ testTimeout: 60_000 });

beforeAll(async () => {
  await setup();
}, 180_000);

afterAll(async () => {
  await teardown();
}, 60_000);

test('outbox-trigger-and-configurable-five-minute-sweep', async () => {
  expect(QUEUE_NAMES).toContain(CHANNEL_SYNC_QUEUE);
  expect(isRepeatableQueue(CHANNEL_SYNC_QUEUE)).toBe(true);
  const schedules = repeatSchedules(config(), CHANNEL_SYNC_QUEUE);
  expect(schedules).toHaveLength(1);
  expect(schedules[0]).toMatchObject({
    id: 'q.channel-sync-scheduler',
    everySeconds: 300,
    data: {},
  });
  expect(String(schedules[0]!.jobName)).toContain('channel-sync');

  // Đăng ký repeat thật trên BullMQ: đúng một scheduler 300 giây, restart không nhân đôi.
  const first = await startWorker();
  const firstSchedulers = await schedulers();
  expect(firstSchedulers).toHaveLength(1);
  expect(firstSchedulers[0]).toMatchObject({ every: 300_000 });
  expect(String(firstSchedulers.at(0)!.name)).toContain('channel-sync');
  await stopWorker(first);
  const second = await startWorker();
  expect(await schedulers()).toHaveLength(1);
  await stopWorker(second);

  // Cấu hình cập nhật đổi nhịp (BR-SYS-02): 300 → 600 giây, không cần triển khai lại.
  await rows("UPDATE system_settings SET value='600' WHERE key='job.channelSync.intervalSeconds'");
  const third = await startWorker();
  const thirdSchedulers = await schedulers();
  expect(thirdSchedulers).toHaveLength(1);
  expect(thirdSchedulers[0]).toMatchObject({ every: 600_000 });
  await stopWorker(third);
  await rows("UPDATE system_settings SET value='300' WHERE key='job.channelSync.intervalSeconds'");

  // Sự kiện tồn/giá đã commit kích đồng bộ ngay, không chờ nhịp 5 phút: một lượt quét đủ để kênh nhận
  // bản tin ở simulator và delivery của relay hoàn tất.
  const eventId = await rows<{ id: string }>(
    "INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,channel_id,payload_json) VALUES('channel.inventory.changed','Channel',$1,$1,'{}'::jsonb) RETURNING id",
    [seed.channels['OTA_BOOKING']],
  ).then((result) => result[0]!.id);
  await rows(
    "INSERT INTO event_deliveries(event_id,consumer,status) VALUES($1,'channel-sync','PENDING')",
    [eventId],
  );
  simulatorRespond(200);
  const worker = await startWorker();
  try {
    await runSweep('hb131-immediate');
    expect(simulatorRequests().length).toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          (
            await rows(
              "SELECT status FROM event_deliveries WHERE event_id=$1 AND consumer='channel-sync'",
              [eventId],
            )
          )[0]?.status,
        { timeout: 5000, interval: 50 },
      )
      .toBe('COMPLETED');
  } finally {
    await stopWorker(worker);
  }
});

test('latest-snapshot-version-and-recovery', async () => {
  const worker = await startWorker();
  simulatorRespond(200);
  try {
    const channelId = seed.channels['OTA_BOOKING']!;
    // Ảnh cũ (version 1) rồi ảnh mới (version 3, có gap): consumer phải gửi ảnh **mới nhất**, không
    // ghi đè bằng bản cũ và không cộng dồn delta.
    const oldEvent = await rows<{ id: string }>(
      `INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,channel_id,payload_json)
       VALUES('channel.inventory.changed','Channel',$1,$1,$2::jsonb) RETURNING id`,
      [channelId, JSON.stringify({ aggregateVersion: 1, roomTypeId: seed.typeId })],
    ).then((result) => result[0]!.id);
    const newEvent = await rows<{ id: string }>(
      `INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,channel_id,payload_json)
       VALUES('channel.inventory.changed','Channel',$1,$1,$2::jsonb) RETURNING id`,
      [channelId, JSON.stringify({ aggregateVersion: 3, roomTypeId: seed.typeId })],
    ).then((result) => result[0]!.id);
    for (const eventId of [oldEvent, newEvent])
      await rows(
        "INSERT INTO event_deliveries(event_id,consumer,status) VALUES($1,'channel-sync','PENDING')",
        [eventId],
      );

    // Mô phỏng Redis mất hàng đợi: delivery vẫn PENDING trong CSDL và được lượt quét phục hồi.
    await runSweep('hb131-recover-1');
    await expect
      .poll(
        async () =>
          (
            await rows(
              "SELECT status FROM event_deliveries WHERE consumer='channel-sync' AND event_id = ANY($1::uuid[]) ORDER BY status",
              [[oldEvent, newEvent]],
            )
          ).map((row) => row.status),
        { timeout: 5000, interval: 50 },
      )
      .toEqual(['COMPLETED', 'COMPLETED']);

    const firstBodies = snapshotBodies();
    expect(firstBodies.length).toBeGreaterThan(0);
    for (const body of firstBodies) expect(body.snapshot?.version).toBe(3);
    const latest = firstBodies.at(-1)!;
    expect(latest.channelId).toBe(channelId);
    expect(Array.isArray(latest.snapshot?.inventory)).toBe(true);

    // Phát lại cùng sự kiện: gửi lại ảnh y hệt (at-least-once), không nhân đôi delta hay delivery.
    await rows(
      "UPDATE event_deliveries SET status='PENDING', completed_at=NULL, lease_token=NULL, lease_expires_at=NULL WHERE consumer='channel-sync' AND event_id = ANY($1::uuid[])",
      [[oldEvent, newEvent]],
    );
    await runSweep('hb131-recover-2');
    const replayed = snapshotBodies();
    expect(replayed.length).toBeGreaterThan(firstBodies.length);
    expect(replayed.at(-1)).toEqual(latest);
    expect(
      await rows(
        "SELECT count(*)::int AS n FROM event_deliveries WHERE consumer='channel-sync' AND event_id = ANY($1::uuid[])",
        [[oldEvent, newEvent]],
      ),
    ).toEqual([{ n: 2 }]);
    for (const body of replayed) expect(body.snapshot?.version).toBe(3);
  } finally {
    await stopWorker(worker);
  }
});

test('built_worker_runtime_and_payload', async () => {
  // Worker chạy bằng composition runtime thật (`defaultWorkerApp` → BullMQ → handler), không gọi handler
  // trực tiếp: dữ liệu job (key/channelId/version) phải đi qua hàng đợi tới adapter.
  const worker = await startWorker();
  simulatorRespond(200);
  try {
    const channelId = seed.channels['OTA_AGODA']!;
    await runSweep('hb131-runtime', { channelId, version: 9 });
    const request = snapshotBodies().find((body) => body.channelId === channelId);
    expect(request).toBeDefined();
    expect(request!.snapshot?.version).toBe(9);
    expect(Array.isArray(request!.snapshot?.inventory)).toBe(true);
    // Không có consumer nào bị đánh COMPLETED trước khi adapter thực sự nhận ảnh.
    expect(simulatorRequests().length).toBeGreaterThan(0);
  } finally {
    await stopWorker(worker);
  }
});
