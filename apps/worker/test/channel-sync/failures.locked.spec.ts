/**
 * HB-131 — test khoá giai đoạn A cho chuỗi thất bại đồng bộ kênh: ba kết quả thất bại **riêng biệt** liên
 * tiếp ⇒ `DEGRADED` + cảnh báo MANAGER + `E_CHAN_SYNC_FAILED` đúng một lần; phát lại cùng attempt không
 * tăng counter hay phát cảnh báo lần hai; một lượt thành công đã xác minh đưa counter về 0/OK nhưng
 * **giữ** lịch sử lỗi/cảnh báo/delivery.
 *
 * Đỏ dự kiến hiện tại: worker chưa có job `q.channel-sync` nên không có lượt đồng bộ nào tới simulator.
 */
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  MANAGER_RECIPIENT,
  alertCount,
  channelState,
  rows,
  runSweep,
  seed,
  setup,
  simulatorRequests,
  simulatorRespond,
  startWorker,
  stopWorker,
  teardown,
} from './harness.js';

// Migration + Postgres + BullMQ mất vài giây mỗi tệp; ngưỡng mặc định 5 giây quá ngắn.
vi.setConfig({ testTimeout: 60_000 });

const channel = () => seed.channels['OTA_BOOKING']!;

beforeAll(async () => {
  await setup();
}, 180_000);

afterAll(async () => {
  await teardown();
}, 60_000);

test('three-failures-degraded-once', async () => {
  simulatorRespond(500);
  const worker = await startWorker();
  try {
    const alertsBefore = await alertCount();
    const notificationsBefore = Number(
      (await rows('SELECT count(*)::int AS n FROM notifications'))[0]!.n,
    );
    expect(await channelState('OTA_BOOKING')).toMatchObject({
      sync_status: 'OK',
      consecutive_sync_failures: 0,
    });

    for (const [index, key] of ['f1', 'f2', 'f3'].entries()) {
      await runSweep(`hb131-${key}`);
      await expect
        .poll(async () => (await channelState('OTA_BOOKING')).consecutive_sync_failures, {
          timeout: 5000,
          interval: 50,
        })
        .toBe(index + 1);
      expect((await channelState('OTA_BOOKING')).sync_status).toBe(index === 2 ? 'DEGRADED' : 'OK');
      expect(await alertCount()).toBe(index === 2 ? alertsBefore + 1 : alertsBefore);
      const notifications = Number(
        (await rows('SELECT count(*)::int AS n FROM notifications'))[0]!.n,
      );
      expect(notifications).toBe(index === 2 ? notificationsBefore + 1 : notificationsBefore);
    }

    const degraded = await channelState('OTA_BOOKING');
    expect(degraded.sync_status).toBe('DEGRADED');
    expect(degraded.consecutive_sync_failures).toBe(3);
    expect(degraded.last_sync_error).toBeTruthy();
    expect(degraded.last_sync_error).toContain('E_CHAN_SYNC_FAILED');
    expect(simulatorRequests().length).toBeGreaterThan(0);
    // Lỗi đã che: chỉ mã lỗi, không nội dung mạng/payload.
    expect(degraded.last_sync_error).not.toContain('SUPER-SECRET');

    // Cảnh báo đúng đích MANAGER, không phải kênh kỹ thuật.
    const managerAlerts = await rows(
      "SELECT id FROM notifications WHERE recipient=$1 AND payload_json->>'reason' LIKE '%OTA_BOOKING%'",
      [MANAGER_RECIPIENT],
    );
    expect(managerAlerts.length).toBeGreaterThan(0);

    // Kênh khác vẫn OK.
    for (const code of ['OTA_AGODA', 'OTA_AIRBNB'])
      expect(await channelState(code)).toMatchObject({
        sync_status: 'OK',
        consecutive_sync_failures: 0,
      });

    // Phát lại CÙNG attempt: không tăng counter, không phát cảnh báo lần hai.
    const alertsAtDegraded = await alertCount();
    const notificationsAtDegraded = Number(
      (await rows('SELECT count(*)::int AS n FROM notifications'))[0]!.n,
    );
    await runSweep('hb131-f3');
    expect((await channelState('OTA_BOOKING')).consecutive_sync_failures).toBe(3);
    expect(await alertCount()).toBe(alertsAtDegraded);
    expect(Number((await rows('SELECT count(*)::int AS n FROM notifications'))[0]!.n)).toBe(
      notificationsAtDegraded,
    );
  } finally {
    await stopWorker(worker);
  }
});

test('success-breaks-consecutive-streak', async () => {
  simulatorRespond(500);
  const worker = await startWorker();
  try {
    await runSweep('hb131-pre-1');
    await runSweep('hb131-pre-2');
    await expect
      .poll(async () => (await channelState('OTA_BOOKING')).consecutive_sync_failures, {
        timeout: 5000,
        interval: 50,
      })
      .toBe(2);

    // Kết quả adapter thật (simulator 200) ⇒ counter 0/OK, nhưng KHÔNG xoá lịch sử lỗi/cảnh báo.
    simulatorRespond(200);
    await runSweep('hb131-success');
    await expect
      .poll(async () => (await channelState('OTA_BOOKING')).consecutive_sync_failures, {
        timeout: 5000,
        interval: 50,
      })
      .toBe(0);
    const healthy = await channelState('OTA_BOOKING');
    expect(healthy.sync_status).toBe('OK');
    expect(healthy.last_sync_at).not.toBeNull();
    expect(healthy.last_sync_error).toContain('E_CHAN_SYNC_FAILED');
    expect(await alertCount()).toBe(0);

    // Thất bại kế tiếp đếm lại từ 1 (không phải 3) — chuỗi đã bị phá bởi lượt thành công.
    simulatorRespond(500);
    await runSweep('hb131-after-success');
    await expect
      .poll(async () => (await channelState('OTA_BOOKING')).consecutive_sync_failures, {
        timeout: 5000,
        interval: 50,
      })
      .toBe(1);
    expect((await channelState('OTA_BOOKING')).sync_status).toBe('OK');
    expect(await alertCount()).toBe(0);
  } finally {
    await stopWorker(worker);
  }
});

test('verified_success_restores_ok', async () => {
  // Lịch sử cũ đã tồn tại trước lượt thành công: cảnh báo, thông báo, audit và delivery hoàn tất.
  await rows(
    "UPDATE channels SET sync_status='DEGRADED', consecutive_sync_failures=3, last_sync_error='E_CHAN_SYNC_FAILED', last_sync_at=now() - interval '1 hour' WHERE id=$1",
    [channel()],
  );
  const notificationId = String(
    (
      await rows<{ id: string }>(
        `INSERT INTO notifications(recipient,channel,template,payload_json) VALUES($1,'EMAIL','alert-channel-degraded',$2::jsonb) RETURNING id`,
        [MANAGER_RECIPIENT, JSON.stringify({ reason: 'Kênh OTA_BOOKING DEGRADED (lịch sử)' })],
      )
    )[0]!.id,
  );
  await rows(
    `INSERT INTO audit_logs(chain_seq,row_hash,actor_role,action,entity_type,entity_id,after_json,reason,at)
     VALUES(0,'pending-database-trigger','SYSTEM','ALERT_RAISED','Notification',$1,$2::jsonb,'Cảnh báo lịch sử',now() - interval '1 hour')`,
    [
      notificationId,
      JSON.stringify({ condition: 'CHANNEL_DEGRADED', subject: `channel:${channel()}` }),
    ],
  );
  const eventId = String(
    (
      await rows<{ id: string }>(
        "INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,channel_id,payload_json) VALUES('channel.inventory.changed','Channel',$1,$1,'{}'::jsonb) RETURNING id",
        [channel()],
      )
    )[0]!.id,
  );
  await rows(
    "INSERT INTO event_deliveries(event_id,consumer,status,attempts,completed_at) VALUES($1,'channel-sync','COMPLETED',1,now() - interval '1 hour')",
    [eventId],
  );
  const before = await channelState('OTA_BOOKING');
  const alertsBefore = await alertCount();
  const notificationsBefore = Number(
    (await rows('SELECT count(*)::int AS n FROM notifications'))[0]!.n,
  );

  simulatorRespond(200);
  const worker = await startWorker();
  try {
    await runSweep('hb131-verify');
    await expect
      .poll(async () => (await channelState('OTA_BOOKING')).sync_status, {
        timeout: 5000,
        interval: 50,
      })
      .toBe('OK');
    const after = await channelState('OTA_BOOKING');
    expect(after.consecutive_sync_failures).toBe(0);
    expect(after.last_sync_at!.getTime()).toBeGreaterThan(before.last_sync_at!.getTime());
    // Giữ lịch sử thay vì xoá: lỗi cuối, cảnh báo, thông báo, delivery vẫn còn.
    expect(after.last_sync_error).toBe('E_CHAN_SYNC_FAILED');
    expect(await alertCount()).toBe(alertsBefore);
    expect(Number((await rows('SELECT count(*)::int AS n FROM notifications'))[0]!.n)).toBe(
      notificationsBefore,
    );
    expect(
      await rows(
        "SELECT status FROM event_deliveries WHERE event_id=$1 AND consumer='channel-sync'",
        [eventId],
      ),
    ).toEqual([{ status: 'COMPLETED' }]);
    expect(simulatorRequests().length).toBeGreaterThan(0);
  } finally {
    await stopWorker(worker);
  }
});
