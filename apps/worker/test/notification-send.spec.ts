import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { loadWorkerConfig } from '../src/config/env.js';
import { ChannelDeliveryError } from '../src/noti/channels.js';
import type { ChannelSender, ChannelSenders } from '../src/noti/channels.js';
import { createNotificationSendJob } from '../src/noti/send.job.js';
import type { JobContext } from '../src/jobs/types.js';

/**
 * HB-168 — job gửi thông báo trên PostgreSQL16 thật: thành công ⇒ `SENT`; lỗi kênh ⇒ tăng `retry_count`;
 * chạm trần 3 lần ⇒ `FAILED` + bản ghi cảnh báo; chạy lại trên bản ghi đã xong là no-op.
 *
 * Chống gửi trùng: hai lượt gọi **đồng thời** cùng một `notificationId` chạy nối tiếp nhờ khoá hàng
 * (`SELECT … FOR UPDATE`) nên kênh chỉ được gọi một lần.
 */
const root = fileURLToPath(new URL('../../..', import.meta.url));
const dbName = `hb168_worker_${randomUUID().replaceAll('-', '')}`;
let owner: pg.Client,
  db: PrismaClient,
  ownerUrl = '',
  bookingId = '';

async function rows(sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await owner.query<Record<string, unknown>>(sql, values)).rows;
}

let logs: string[] = [];

function context(): JobContext {
  logs = [];
  return {
    db,
    config: loadWorkerConfig({
      DATABASE_URL: ownerUrl,
      REDIS_URL: 'redis://127.0.0.1:6379',
      LOG_LEVEL: 'silent',
    }),
    clock: { now: () => new Date('2026-11-05T00:00:00Z') },
    log: ({ queue, msg }) => logs.push(`${queue}:${msg}`),
  };
}

async function insertNotification(status = 'PENDING', retryCount = 0): Promise<string> {
  const id = randomUUID();
  await rows(
    `INSERT INTO notifications(id, booking_id, recipient, channel, template, payload_json, status, retry_count)
     VALUES($1::uuid,$2::uuid,'guest@example.com','EMAIL','booking-confirmed','{"bookingCode":"PH-261168-HB168","guestName":"Khách HB-168"}'::jsonb,$3,$4)`,
    [id, bookingId, status, retryCount],
  );
  return id;
}

function recordingSenders(fail: boolean): { senders: ChannelSenders; sent: string[] } {
  const sent: string[] = [];
  const sender: ChannelSender = {
    send: async () => {
      if (fail) throw new ChannelDeliveryError('EMAIL_DELIVERY_FAILED');
      sent.push('sent');
    },
  };
  return {
    sent,
    senders: { EMAIL: sender, SMS: sender, ZALO_OA: sender, PUSH: sender },
  };
}

/**
 * Bộ gửi giữ lượt gửi cho tới khi test thả. `starts` đếm số lần kênh **được gọi** (ghi ngay khi vào
 * `send`, trước khi chờ) — đây mới là thứ chứng minh không gửi trùng; `entered` xác nhận lượt đầu đã vào
 * trong transaction (đang giữ khoá hàng).
 */
function gatedSenders(): {
  senders: ChannelSenders;
  entered: Promise<void>;
  release: () => void;
  starts: string[];
  sent: string[];
} {
  const starts: string[] = [];
  const sent: string[] = [];
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const sender: ChannelSender = {
    send: async () => {
      starts.push('started');
      entered.resolve();
      await gate.promise;
      sent.push('sent');
    },
  };
  return {
    starts,
    sent,
    entered: entered.promise,
    release: gate.resolve,
    senders: { EMAIL: sender, SMS: sender, ZALO_OA: sender, PUSH: sender },
  };
}

beforeAll(async () => {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  if (!migrationUrl) throw new Error('HB-168 requires PostgreSQL16; no skip fallback');
  const admin = new pg.Client({ connectionString: migrationUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const target = new URL(migrationUrl);
  target.pathname = `/${dbName}`;
  ownerUrl = target.href;
  const migration = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  expect(migration.status).toBe(0);
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  db = new PrismaClient({ datasourceUrl: ownerUrl });
  const propertyId = String(
    (
      await rows(
        "INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES('HB168','HB168','x','+84900000168',0,0) RETURNING id",
      )
    )[0]!.id,
  );
  // Chèn policy trước: `rate_plans` tham chiếu `cancellation_policies`, và `pg` không cho chạy hai
  // lệnh song song trên cùng một client (chỉ báo hỏng ở pg@9).
  const policy = await rows(
    "INSERT INTO cancellation_policies(code,name) VALUES('HB168','HB168') RETURNING id",
  );
  const rate = await rows(
    "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('FLEX7','HB168',30,$1) RETURNING id",
    [String(policy[0]!.id)],
  );
  const channel = await rows(
    "INSERT INTO channels(code,name,multiplier) VALUES('WEB','WEB',1) RETURNING id",
  );
  const type = await rows(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','STD',2,1000000,500000,2000000) RETURNING id",
    [propertyId],
  );
  const guest = await rows(
    "INSERT INTO guests(full_name,phone) VALUES('Khách HB-168','+84900000168') RETURNING id",
  );
  expect(policy.length + rate.length + channel.length + type.length + guest.length).toBe(5);
  bookingId = String(
    (
      await rows(
        `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent,status)
         VALUES('PH-261168-HB168',$1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'2026-11-01','2026-11-03',2,30,'CONFIRMED') RETURNING id`,
        [
          String(guest[0]!.id),
          propertyId,
          String(type[0]!.id),
          String(rate[0]!.id),
          String(channel[0]!.id),
        ],
      )
    )[0]!.id,
  );
}, 120000);

afterAll(async () => {
  await db?.$disconnect();
  await owner?.end();
  const admin = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH(FORCE)`);
  await admin.end();
}, 60000);

describe('HB-168 · notificationSendJob', () => {
  test('gửi thành công ⇒ SENT + sent_at; chạy lại không gửi lần hai', async () => {
    const id = await insertNotification();
    const { senders, sent } = recordingSenders(false);
    const job = createNotificationSendJob(senders);
    await job({ notificationId: id }, context());
    expect(sent).toHaveLength(1);
    const stored = await rows(
      'SELECT status, sent_at, error_message FROM notifications WHERE id=$1::uuid',
      [id],
    );
    expect(stored[0]).toMatchObject({ status: 'SENT', error_message: null });
    expect(stored[0]!.sent_at).toBeInstanceOf(Date);
    await job({ notificationId: id }, context());
    expect(sent).toHaveLength(1);
  });

  test('lỗi kênh ⇒ tăng retry_count và giữ PENDING cho lượt sau; chạm trần thì FAILED + cảnh báo', async () => {
    const id = await insertNotification();
    const { senders } = recordingSenders(true);
    const job = createNotificationSendJob(senders);
    await expect(job({ notificationId: id }, context())).rejects.toThrow('EMAIL_DELIVERY_FAILED');
    expect(
      (await rows('SELECT status, retry_count FROM notifications WHERE id=$1::uuid', [id]))[0],
    ).toMatchObject({ status: 'PENDING', retry_count: 1 });
    await expect(job({ notificationId: id }, context())).rejects.toThrow('EMAIL_DELIVERY_FAILED');
    await expect(job({ notificationId: id }, context())).rejects.toThrow('EMAIL_DELIVERY_FAILED');
    const stored = await rows(
      'SELECT status, retry_count, error_message FROM notifications WHERE id=$1::uuid',
      [id],
    );
    expect(stored[0]).toMatchObject({ status: 'FAILED', retry_count: 3 });
    expect(String(stored[0]!.error_message)).toContain('EMAIL_DELIVERY_FAILED');
    const alerts = await rows(
      "SELECT action, after_json->>'status' AS status FROM audit_logs WHERE action='NOTIFICATION_DELIVERY_FAILED' AND entity_id=$1::uuid",
      [id],
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ status: 'FAILED' });
  });

  test('thông báo không còn tồn tại hoặc payload sai kiểu ⇒ no-op / lỗi rõ ràng', async () => {
    const { senders, sent } = recordingSenders(false);
    const job = createNotificationSendJob(senders);
    await job({ notificationId: randomUUID() }, context());
    expect(sent).toHaveLength(0);
    await expect(job({ notificationId: 'không-phải-uuid' }, context())).rejects.toThrow(
      'NOTIFICATION_PAYLOAD_INVALID',
    );
  });

  test('hai lượt gọi đồng thời cùng một thông báo ⇒ kênh chỉ được gọi một lần, hàng chỉ SENT', async () => {
    const id = await insertNotification();
    const { senders, starts, sent, entered, release } = gatedSenders();
    const job = createNotificationSendJob(senders);
    const first = job({ notificationId: id }, context());
    // Lượt đầu đã qua `SELECT … FOR UPDATE` và đang giữ khoá hàng (đang trong lượt gọi kênh).
    await entered;
    const second = job({ notificationId: id }, context());
    try {
      // Lượt thứ hai phải **chờ khoá hàng**: có backend đang chờ khoá nghĩa là nó chưa đọc được `PENDING`.
      // Không có khoá thì nó đọc `PENDING` và gọi kênh lần hai — đúng kịch bản gửi trùng cần chặn.
      await vi.waitFor(async () => {
        const waiting = await rows('SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted');
        expect(waiting[0]!.n).toBeGreaterThan(0);
      });
      expect(starts).toHaveLength(1);
    } finally {
      release();
      await Promise.allSettled([first, second]);
    }
    expect(starts).toHaveLength(1);
    expect(sent).toHaveLength(1);
    // Lượt thứ hai đọc thấy `SENT` của lượt đầu nên thoát.
    expect(logs.join('\n')).toContain('không gửi lại (trạng thái SENT)');
    const stored = await rows(
      'SELECT status, retry_count, sent_at FROM notifications WHERE id=$1::uuid',
      [id],
    );
    expect(stored[0]).toMatchObject({ status: 'SENT', retry_count: 0 });
    expect(stored[0]!.sent_at).toBeInstanceOf(Date);
  });

  test('lỗi gửi không phải mã kênh ⇒ vẫn tăng retry_count với thông điệp chung', async () => {
    const id = await insertNotification();
    const recording = recordingSenders(false);
    const senders: ChannelSenders = {
      ...recording.senders,
      EMAIL: {
        send: async () => {
          throw new Error('lỗi không xác định từ bộ gửi');
        },
      },
    };
    await expect(
      createNotificationSendJob(senders)({ notificationId: id }, context()),
    ).rejects.toThrow('lỗi không xác định từ bộ gửi');
    const stored = await rows(
      'SELECT status, retry_count, error_message FROM notifications WHERE id=$1::uuid',
      [id],
    );
    expect(stored[0]).toMatchObject({
      status: 'PENDING',
      retry_count: 1,
      error_message: 'Kênh gửi thất bại.',
    });
  });

  test('hàng đã chạm trần lượt gửi mà còn PENDING ⇒ chốt FAILED tại chỗ, không gọi kênh', async () => {
    const id = await insertNotification('PENDING', 3);
    const { senders, sent } = recordingSenders(false);
    await createNotificationSendJob(senders)({ notificationId: id }, context());
    expect(sent).toHaveLength(0);
    const stored = await rows(
      'SELECT status, retry_count, error_message FROM notifications WHERE id=$1::uuid',
      [id],
    );
    expect(stored[0]).toMatchObject({
      status: 'FAILED',
      retry_count: 3,
      error_message: 'Hết lượt gửi lại theo BR-SYS-06.',
    });
    const alerts = await rows(
      "SELECT entity_id FROM audit_logs WHERE action='NOTIFICATION_DELIVERY_FAILED' AND entity_id=$1::uuid",
      [id],
    );
    expect(alerts).toHaveLength(1);
  });

  test('lượt gọi thứ hai sau khi lượt đầu đã xong vẫn là no-op', async () => {
    const id = await insertNotification();
    const { senders, sent } = recordingSenders(false);
    const job = createNotificationSendJob(senders);
    await job({ notificationId: id }, context());
    const before = await rows('SELECT status, sent_at FROM notifications WHERE id=$1::uuid', [id]);
    await job({ notificationId: id }, context());
    const after = await rows('SELECT status, sent_at FROM notifications WHERE id=$1::uuid', [id]);
    expect(sent).toHaveLength(1);
    expect(after[0]).toEqual(before[0]);
  });
});
