import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { loadWorkerConfig } from '../../src/config/env.js';
import type { WorkerConfig } from '../../src/config/env.js';
import { createAlertsJob } from '../../src/jobs/alerts/alerts.job.js';
import type { AlertQueuePort } from '../../src/jobs/alerts/alerts.job.js';
import { createNotificationSendJob } from '../../src/noti/send.job.js';
import { channelSenders } from '../../src/noti/channels.js';
import { smtpSettings } from '../../src/noti/smtp.js';
import { createHoldTestDb, seedHold } from '../hold-expiry/harness.js';
import type { HoldFixture, HoldTestDb } from '../hold-expiry/harness.js';
import { acceptAllScript, startFakeSmtp } from '../fake-smtp.js';
import type { JobContext } from '../../src/jobs/types.js';

/**
 * HB-182 — cảnh báo vận hành trên PostgreSQL16 thật + Redis DB 26 (chống trùng) + SMTP giả (đường noti).
 *
 * Mỗi ca chỉ khẳng định **đối tượng của mình** (`audit_logs.after_json->>'subject'`) nên các fixture dùng
 * chung một CSDL không làm nhiễu nhau; `notifications` phát sinh trước ca khác cũng không ảnh hưởng.
 */
const OPS = 'ops@pinehill.local';
const MANAGER = 'manager@pinehill.local';
const OWNER = 'owner@pinehill.local';
const ROTATION = 'ops-rotation@pinehill.test';

interface AlertsHarness {
  readonly context: JobContext;
  readonly logs: string[];
}

let testDb: HoldTestDb;
let redis: Redis;
let redisUrl = '';
let managerId = '';
let ownerId = '';

function harness(db: HoldTestDb, over: Partial<WorkerConfig> = {}): AlertsHarness {
  const config: WorkerConfig = {
    ...loadWorkerConfig({
      DATABASE_URL: db.ownerUrl,
      REDIS_URL: redisUrl,
      LOG_LEVEL: 'silent',
    }),
    ...over,
  };
  const logs: string[] = [];
  return {
    logs,
    context: {
      db: db.db,
      config,
      clock: { now: () => new Date() },
      log: (entry) => logs.push(entry.msg),
    },
  };
}

/** Hàng đợi giả: giữ id thông báo để khẳng định đúng số cảnh báo đã phát. */
function fakeQueue(ids: string[]): AlertQueuePort {
  return {
    async add(notificationId) {
      ids.push(notificationId);
    },
    async close() {
      await Promise.resolve();
    },
  };
}

async function scan(h: AlertsHarness): Promise<string[]> {
  const ids: string[] = [];
  await createAlertsJob({ queue: () => fakeQueue(ids) })({}, h.context);
  return ids;
}

/** Số cảnh báo đã ghi cho một đối tượng (hoặc toàn bộ) — nguồn chân lý là nhật ký kiểm toán. */
async function alertCount(subject: string): Promise<number> {
  const rows = await testDb.rows(
    `SELECT count(*) AS n FROM audit_logs WHERE action = 'ALERT_RAISED' AND after_json->>'subject' = $1`,
    [subject],
  );
  return Number(rows[0]!.n);
}

async function notificationsOf(subject: string) {
  return testDb.rows(
    `SELECT n.recipient, n.template, n.channel, n.status, a.after_json
       FROM audit_logs a JOIN notifications n ON n.id = a.entity_id
      WHERE a.action = 'ALERT_RAISED' AND a.after_json->>'subject' = $1
      ORDER BY n.recipient`,
    [subject],
  );
}

async function blockOverAssignment(fixture: HoldFixture): Promise<void> {
  // Nhánh MANAGER/OWNER được phép khoá đè lên lịch đang bán (`fn_guard_room_block_overlap`).
  await testDb.db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL app.actor_role = 'MANAGER'");
    await tx.$executeRaw`
      INSERT INTO room_blocks(room_id, start_date, end_date, reason, created_by)
      VALUES (${fixture.roomIds[0]!}::uuid, ${fixture.checkIn}::date, ${fixture.checkOut}::date,
              'MAINTENANCE', ${managerId}::uuid)`;
  });
}

async function approvedRefund(
  bookingId: string,
  policyId: string,
  daysAgo: number,
): Promise<string> {
  const requester = (
    await testDb.rows(
      `INSERT INTO users(username,password_hash,full_name,role)
       VALUES($1,'x','Requester test','FRONT_DESK') RETURNING id`,
      [`hb182-requester-${daysAgo}`],
    )
  )[0]!.id;
  const refund = (
    await testDb.rows(
      `INSERT INTO refund_requests(booking_id,event_key,policy_id,hours_before_check_in,
         refund_percent,requested_amount,reason,requested_by,requester_type,requester_id)
       VALUES($1::uuid,$2,$3::uuid,24,100,1000000,'GUEST_REQUEST',$4::uuid,'USER',$4::text)
       RETURNING id`,
      [bookingId, `HB182-${daysAgo}`, policyId, requester],
    )
  )[0]!.id;
  await testDb.rows(
    `INSERT INTO refund_approvals(refund_request_id,request_version,approver_id,approver_role,
       decision,approved_amount,refund_fee,reason)
     VALUES($1::uuid,1,$2::uuid,'OWNER','APPROVED',1000000,0,'HB-182 test')`,
    [refund, ownerId],
  );
  await testDb.rows(
    `UPDATE refund_requests
        SET status='APPROVED', approved_amount=1000000, approved_by=$2::uuid,
            decided_at=clock_timestamp() - make_interval(days => $3::int)
      WHERE id=$1::uuid`,
    [refund, ownerId, daysAgo],
  );
  return String(refund);
}

beforeAll(async () => {
  testDb = await createHoldTestDb('alerts');
  // Dùng đúng DB trong `REDIS_URL` (lead cấp DB riêng) — không tự đổi sang DB khác.
  redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0';
  redis = new Redis(redisUrl);
  await redis.ping();
  managerId = String(
    (
      await testDb.rows(
        `INSERT INTO users(username,password_hash,full_name,role)
         VALUES('hb182-manager','x','Quản lý test','MANAGER') RETURNING id`,
      )
    )[0]!.id,
  );
  ownerId = String(
    (
      await testDb.rows(
        `INSERT INTO users(username,password_hash,full_name,role)
         VALUES('hb182-owner','x','Chủ test','OWNER') RETURNING id`,
      )
    )[0]!.id,
  );
}, 120_000);

afterAll(async () => {
  await redis?.quit();
  await testDb?.close();
}, 30_000);

beforeEach(async () => {
  await redis.flushdb();
});

describe('HB-182 — quét cảnh báo vận hành', () => {
  it('mỗi điều kiện → đúng một cảnh báo cho mỗi đích, không gửi cho vai trò khác', async () => {
    const conflict = await seedHold(testDb.db, {
      label: 'conflict',
      units: 1,
      expiresInSeconds: 3600,
    });
    await blockOverAssignment(conflict);
    const stock = await seedHold(testDb.db, {
      label: 'stock',
      units: 1,
      allotmentUsed: 1,
      expiresInSeconds: 3600,
    });
    await testDb.db.$executeRaw`
      UPDATE channel_allotments SET used = 4
       WHERE channel_id = ${stock.channelId}::uuid AND room_type_id = ${stock.roomTypeId}::uuid
         AND date = ${stock.checkIn}::date`;
    const degraded = String(
      (
        await testDb.rows(
          `INSERT INTO channels(code,name,multiplier,sync_status,consecutive_sync_failures)
           VALUES('OTA_AGODA','Kênh suy giảm',1.0,'DEGRADED',3) RETURNING id`,
        )
      )[0]!.id,
    );
    const login = String(
      (
        await testDb.rows(
          `INSERT INTO users(username,password_hash,full_name,role,failed_login_count,locked_until)
           VALUES('hb182-locked','x','Tài khoản khoá','FRONT_DESK',5,
                  clock_timestamp() + interval '15 minutes') RETURNING id`,
        )
      )[0]!.id,
    );
    const policy = String(
      (await testDb.rows(`SELECT id FROM cancellation_policies WHERE code='HB078-POLICY'`))[0]!.id,
    );
    const refund = await approvedRefund(conflict.bookingId, policy, 8);

    const h = harness(testDb);
    const ids = await scan(h);

    const conflictAlerts = await notificationsOf(`room:${conflict.roomIds[0]}`);
    expect(conflictAlerts).toHaveLength(1);
    expect(conflictAlerts[0]).toMatchObject({ recipient: OPS, template: 'alert-room-conflict' });

    const stockAlerts = await notificationsOf(`allotment:WEB:STD:${stock.checkIn}`);
    expect(stockAlerts.map((row) => row.recipient)).toEqual([MANAGER, OPS].sort());
    expect(stockAlerts.every((row) => row.template === 'alert-inventory-overbook')).toBe(true);
    expect(stockAlerts.some((row) => row.recipient === OWNER)).toBe(false);

    expect(await notificationsOf(`channel:${degraded}`)).toMatchObject([
      { recipient: MANAGER, template: 'alert-channel-degraded' },
    ]);
    expect(await notificationsOf(`user:${login}`)).toMatchObject([
      { recipient: OPS, template: 'alert-login-abnormal' },
    ]);
    expect(await notificationsOf(`refund:${refund}`)).toMatchObject([
      { recipient: OWNER, template: 'alert-refund-sla' },
    ]);
    // Mọi hàng đều là email của đường noti và đã được phát job gửi.
    expect(ids).toHaveLength(6);
    const all = await testDb.rows(
      `SELECT DISTINCT recipient, channel FROM notifications WHERE template LIKE 'alert-%'`,
    );
    expect(all.every((row) => row.channel === 'EMAIL')).toBe(true);
    expect(new Set(all.map((row) => row.recipient))).toEqual(new Set([OPS, MANAGER, OWNER]));
    const audit = await testDb.rows(
      `SELECT actor_role, entity_type, after_json->>'target' AS target
         FROM audit_logs WHERE action='ALERT_RAISED' ORDER BY chain_seq`,
    );
    expect(audit.filter((row) => row.actor_role === 'SYSTEM')).toHaveLength(audit.length);
    expect(audit.every((row) => row.entity_type === 'Notification')).toBe(true);
    expect(h.logs.at(-1)).toContain('gửi 6 cảnh báo');
  });

  it('đăng nhập từ bề mặt lạ → cảnh báo; bề mặt hợp lệ thì không', async () => {
    const subject = 'surface:ROOT_SHELL';
    const before = await alertCount(subject);
    for (const surface of ['OPS_WEB', 'ROOT_SHELL']) {
      await testDb.rows(
        `INSERT INTO audit_logs(chain_seq,row_hash,actor_id,actor_role,action,entity_type,
           entity_id,before_json,after_json,reason,at)
         VALUES(0,'pending',NULL,'SYSTEM','AUTH_LOGIN_FAILURE','User',NULL,NULL,$1::jsonb,
                'HB-182 test',clock_timestamp())`,
        [JSON.stringify({ clientSurface: surface })],
      );
    }
    await scan(harness(testDb));
    expect(await alertCount(subject)).toBe(before + 1);
    expect(await alertCount('surface:OPS_WEB')).toBe(0);
  });

  it('ngưỡng/địa chỉ nhận lấy từ system_settings, không hằng số hoá', async () => {
    await testDb.rows(
      `INSERT INTO system_settings(key,value,value_type) VALUES
         ('alerts.recipient.manager',$1,'STRING'),
         ('alerts.refund.slaDays','1','NUMBER')
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [ROTATION],
    );
    const channel = String(
      (
        await testDb.rows(
          `INSERT INTO channels(code,name,multiplier,sync_status,consecutive_sync_failures)
           VALUES('OTA_AIRBNB','Kênh suy giảm 2',1.0,'DEGRADED',3) RETURNING id`,
        )
      )[0]!.id,
    );
    const seeded = await seedHold(testDb.db, { label: 'sla', expiresInSeconds: 3600 });
    const policy = String(
      (await testDb.rows(`SELECT id FROM cancellation_policies WHERE code='HB078-POLICY'`))[0]!.id,
    );
    const refund = await approvedRefund(seeded.bookingId, policy, 2);

    await scan(harness(testDb));

    expect(await notificationsOf(`channel:${channel}`)).toMatchObject([
      { recipient: ROTATION, template: 'alert-channel-degraded' },
    ]);
    // Mặc định 7 ngày sẽ bỏ qua yêu cầu 2 ngày; ngưỡng 1 ngày bắt được.
    expect(await alertCount(`refund:${refund}`)).toBe(1);
  });

  it('chống trùng: lượt thứ hai trong cửa sổ không gửi lại; hết cửa sổ thì báo lại', async () => {
    await testDb.rows(
      `INSERT INTO system_settings(key,value,value_type) VALUES('alerts.roomConflict.dedupSeconds','1','NUMBER')
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
    const fixture = await seedHold(testDb.db, { label: 'dedup', expiresInSeconds: 3600 });
    await blockOverAssignment(fixture);
    const subject = `room:${fixture.roomIds[0]}`;

    await scan(harness(testDb));
    expect(await alertCount(subject)).toBe(1);
    await scan(harness(testDb));
    expect(await alertCount(subject)).toBe(1);

    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 1200);
    await promise;
    await scan(harness(testDb));
    expect(await alertCount(subject)).toBe(2);
  });

  it('cảnh báo đi qua đường noti: gửi email thật tới SMTP và đóng dấu SENT', async () => {
    const pending = await testDb.rows(
      `SELECT id FROM notifications WHERE template LIKE 'alert-%' AND recipient = $1
        ORDER BY created_at DESC LIMIT 1`,
      [OPS],
    );
    const notificationId = String(pending[0]!.id);
    const server = await startFakeSmtp(acceptAllScript());
    try {
      const h = harness(testDb, {
        NOTI_SMTP_URL: server.url,
        NOTI_SMTP_FROM: 'no-reply@pinehill.test',
      });
      const handler = createNotificationSendJob(channelSenders(smtpSettings(h.context.config)));
      await handler({ notificationId }, h.context);
    } finally {
      await server.close();
    }
    expect(server.lines).toContain(`RCPT TO:<${OPS}>`);
    expect(server.lines.join('\n')).toContain('Subject: Cảnh báo');
    const row = await testDb.rows(`SELECT status, sent_at FROM notifications WHERE id=$1::uuid`, [
      notificationId,
    ]);
    expect(row[0]).toMatchObject({ status: 'SENT' });
    expect(row[0]!.sent_at).not.toBeNull();
  });
});
