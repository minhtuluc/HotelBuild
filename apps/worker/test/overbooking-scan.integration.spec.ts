/* eslint-disable max-lines -- HB-127 AC3…AC11 are seven independently named PG16/Redis cases (fixture + dist build) in the only integration spec file the ticket allows; splitting them would need files outside `allow`. */
/**
 * HB-127 — worker quét quá tải trên PostgreSQL 16 + Redis 7 thật (không nhánh bỏ qua khi thiếu hạ tầng).
 *
 * Handler được gọi với đồng hồ giả điều khiển được; use case phát hiện là bản thật của HB-126 nạp qua
 * composition runtime. Ca cuối build từ checkout sạch và chạy `node --conditions=pinehill-dist dist/main.js`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { redisOptions } from '../src/bullmq.factory.js';
import type { JobContext } from '../src/jobs/types.js';
import { loadWorkerConfig } from '../src/config/env.js';
import { SCAN_INTERVAL_KEY } from '../src/overbooking/interval.js';
import { overbookingScanJob } from '../src/overbooking/scan.job.js';
import {
  OVERBOOKING_SCAN_JOB,
  OVERBOOKING_SCAN_QUEUE,
  OVERBOOKING_SCAN_SCHEDULER_ID,
} from '../src/queues.js';
import type { QueueName } from '../src/queues.js';
import { createOtaTestDb } from './ota-inbox/fixture.js';
import type { OtaTestDb } from './ota-inbox/fixture.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const GUEST = { name: 'HB127 Synthetic Guest', phone: '+84900000127' };
const D = '2026-12-10';
const D1 = '2026-12-11';
/** Hạn T−24h của ngày D: 14:00 giờ VN của D−1 = 07:00Z. */
const BEFORE_DEADLINE = new Date('2026-12-09T06:59:59Z');
const AT_DEADLINE = new Date('2026-12-09T07:00:00Z');
const TODAY = new Date('2026-12-03T03:00:00Z');

let testDb: OtaTestDb;
let now = TODAY;
let logs: { queue: QueueName; msg: string; errorCode?: string }[] = [];
const ids = { property: '', roomType: '', rate: '', guest: '', channel: '' };

const rows = (sql: string, values?: unknown[]) => testDb.rows(sql, values);
const text = (value: unknown) => String(value);
const count = async (table: string, where = 'true') =>
  Number((await rows(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))[0]?.n);

function context(db: PrismaClient = testDb.db): JobContext {
  return {
    db,
    config: loadWorkerConfig({
      DATABASE_URL: testDb.ownerUrl,
      REDIS_URL: 'redis://127.0.0.1:6379',
    }),
    clock: { now: () => now },
    log: (entry) => {
      logs.push(entry);
    },
  };
}

const runJob = (db?: PrismaClient) =>
  overbookingScanJob(
    {},
    context(db),
    { attempt: 1, attempts: 3 },
    { id: randomUUID(), name: OVERBOOKING_SCAN_JOB },
  );

async function insertOne(sql: string, values: unknown[] = []): Promise<string> {
  return text((await rows(sql, values))[0]?.id);
}

/** Một loại phòng STD có đúng 2 phòng ⇒ booking thứ 3 trùng đêm là thiếu 1 phòng. */
async function seedBase(): Promise<void> {
  ids.property = await insertOne(
    "INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES('H127-A','HB127','HB127 address','0900000000',0,0) RETURNING id",
  );
  const policy = await insertOne(
    "INSERT INTO cancellation_policies(code,name) VALUES('H127','Synthetic') RETURNING id",
  );
  ids.rate = await insertOne(
    "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('FLEX7','Synthetic',30,$1) RETURNING id",
    [policy],
  );
  ids.guest = await insertOne('INSERT INTO guests(full_name,phone) VALUES($1,$2) RETURNING id', [
    GUEST.name,
    GUEST.phone,
  ]);
  ids.channel = await insertOne(
    "INSERT INTO channels(code,name,multiplier) VALUES('WEB','WEB',1) RETURNING id",
  );
  ids.roomType = await insertOne(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','STD',2,100000,100000,200000) RETURNING id",
    [ids.property],
  );
  for (const code of ['R1', 'R2'])
    await rows(
      'INSERT INTO rooms(property_id,room_type_id,code,name,bed_count) VALUES($1,$2,$3,$3,1)',
      [ids.property, ids.roomType, code],
    );
}

async function book(checkIn: string, checkOut: string, status = 'CONFIRMED'): Promise<string> {
  const id = await insertOne(
    `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent,status,cancelled_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,30,$9,CASE WHEN $9='CANCELLED' THEN clock_timestamp() END) RETURNING id`,
    [
      `PH-261201-${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`,
      ids.guest,
      ids.property,
      ids.roomType,
      ids.rate,
      ids.channel,
      checkIn,
      checkOut,
      status,
    ],
  );
  await rows(
    'INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night) VALUES($1,$2,1,100000)',
    [id, ids.roomType],
  );
  return id;
}

const overbook = async (checkIn: string, checkOut: string) => {
  for (let index = 0; index < 3; index += 1) await book(checkIn, checkOut);
};

const caseRows = () =>
  rows(
    'SELECT id, date::text AS date, status, shortage_count, detected_at, escalated_at, resolved_at FROM overbooking_cases ORDER BY date',
  );
const runRows = () =>
  rows(
    'SELECT id, status, finished_at, case_count, failure_code FROM overbooking_scan_runs ORDER BY started_at, id',
  );
const events = (type: string) =>
  rows('SELECT payload_json FROM outbox_events WHERE event_type=$1', [type]);

/** Cắt `$transaction` của Prisma: lỗi trước commit, lỗi sau commit, hoặc giữ lại tới khi `release()`. */
function interposed(real: PrismaClient, mode: 'before' | 'after' | 'gate') {
  const gate = Promise.withResolvers<void>();
  let tripped = false;
  const proxy = new Proxy(real, {
    get(target, prop) {
      if (prop === '$transaction' && !tripped) {
        tripped = true;
        return async (...args: Parameters<PrismaClient['$transaction']>) => {
          if (mode === 'before') throw new Error('boom before commit');
          if (mode === 'gate') await gate.promise;
          const result: unknown = await Reflect.apply(target.$transaction, target, args);
          if (mode === 'after') throw new Error('boom after commit');
          return result;
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const bound: unknown = Reflect.apply(Function.prototype.bind, value, [target]);
      return bound;
    },
  });
  return { proxy, release: () => gate.resolve() };
}

beforeAll(async () => {
  testDb = await createOtaTestDb('overbooking_scan');
}, 120_000);

afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  await rows('TRUNCATE properties, guests, channels, cancellation_policies, outbox_events CASCADE');
  await seedBase();
  now = TODAY;
  logs = [];
});

describe('HB-127 quét quá tải với CSDL thật', () => {
  test('TC_OVER_01_worker_uses_shared_detection', async () => {
    await overbook(D, D1); // 3 booking đêm D
    await overbook(D1, '2026-12-12'); // 3 booking đêm D+1 ⇒ tổng 6 booking, 2 ngày
    expect(await count('bookings')).toBe(6);
    const money = [
      await count('payments'),
      await count('room_assignments'),
      await count('notifications'),
      await count('refund_requests'),
    ];

    await runJob();
    const found = await caseRows();
    expect(found.map((row) => [row.date, row.status, Number(row.shortage_count)])).toEqual([
      [D, 'OPEN', 1],
      [D1, 'OPEN', 1],
    ]);
    // Một lượt job = một lượt quét của use case (RUNNING→SUCCEEDED), có đếm ca mới.
    expect((await runRows()).map((row) => [row.status, Number(row.case_count)])).toEqual([
      ['SUCCEEDED', 2],
    ]);
    expect(await count('overbooking_scan_runs', "status='RUNNING'")).toBe(0);

    // Quét lại: gộp vào ca cũ, không tạo ca thứ ba.
    await runJob();
    expect(await count('overbooking_cases')).toBe(2);
    // Worker không có tác động tiền/phòng/thông báo.
    expect([
      await count('payments'),
      await count('room_assignments'),
      await count('notifications'),
      await count('refund_requests'),
    ]).toEqual(money);
    expect(await count('bookings')).toBe(6);
  }, 60_000);

  test('TC_OVER_02_fake_clock_deadline_escalation', async () => {
    await overbook(D, D1);
    await runJob();
    expect((await caseRows())[0]?.status).toBe('OPEN');

    now = BEFORE_DEADLINE;
    await runJob();
    expect((await caseRows())[0]?.status).toBe('OPEN');
    expect(await events('overbooking.case.escalated')).toHaveLength(0);

    now = AT_DEADLINE;
    await runJob();
    const [escalated] = await caseRows();
    expect(escalated?.status).toBe('ESCALATED');
    expect(new Date(text(escalated?.escalated_at)).toISOString()).toBe(AT_DEADLINE.toISOString());
    const outbox = await events('overbooking.case.escalated');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.payload_json).toMatchObject({
      notifyRole: 'OWNER',
      toStatus: 'ESCALATED',
      date: D,
    });
    await runJob(); // lượt kế không phát lại sự kiện
    expect(await events('overbooking.case.escalated')).toHaveLength(1);

    // Ca mới nhận sau hạn leo thang ngay qua đường detection (không đợi lượt scheduler kế).
    await overbook('2026-12-09', D);
    await runJob();
    const late = (await caseRows()).find((row) => row.date === '2026-12-09');
    expect(late?.status).toBe('ESCALATED');
  }, 60_000);

  test('TC_OVER_17_past_case_preserved', async () => {
    await overbook(D, D1);
    await runJob();
    const [before] = await caseRows();
    // Qua ngày D, huỷ hết booking ⇒ không còn thiếu thực tế, nhưng ca ngày đã qua vẫn giữ.
    await rows("UPDATE bookings SET status='CANCELLED', cancelled_at=clock_timestamp()");
    now = new Date('2026-12-12T03:00:00Z');
    await runJob();
    now = new Date('2027-02-01T03:00:00Z'); // đã rời hẳn cửa sổ 30 ngày
    await runJob();
    const after = await caseRows();
    expect(after).toHaveLength(1);
    expect(after[0]?.status).toBe('ESCALATED');
    expect(after[0]?.resolved_at).toBeNull();
    expect(text(after[0]?.detected_at)).toBe(text(before?.detected_at));
    expect(after[0]?.escalated_at).not.toBeNull();
  }, 60_000);

  test('HB127_duplicate_retry_and_restart_safe', async () => {
    await overbook(D, D1);
    // Hai worker / giao job trùng đồng thời: đúng 1 ca, đúng 1 sự kiện tạo ca.
    await Promise.all([runJob(), runJob()]);
    expect(await count('overbooking_cases')).toBe(1);
    expect(await events('overbooking.case.opened')).toHaveLength(1);

    // Lỗi TRƯỚC commit: job ném mã ổn định (không nuốt rồi ACK); lượt retry hội tụ.
    await rows('TRUNCATE overbooking_cases CASCADE');
    await rows('TRUNCATE outbox_events CASCADE');
    const before = interposed(testDb.db, 'before');
    await expect(runJob(before.proxy)).rejects.toThrow(new Error('OVERBOOKING_SCAN_FAILED'));
    expect(logs.at(-1)).toMatchObject({
      queue: OVERBOOKING_SCAN_QUEUE,
      errorCode: 'OVERBOOKING_SCAN_FAILED',
    });
    expect(await count('overbooking_cases')).toBe(0);
    await runJob();
    expect(await count('overbooking_cases')).toBe(1);

    // Lỗi SAU commit: dữ liệu đã bền; retry không tạo ca/sự kiện mới.
    await rows('TRUNCATE overbooking_cases CASCADE');
    await rows('TRUNCATE outbox_events CASCADE');
    const after = interposed(testDb.db, 'after');
    await expect(runJob(after.proxy)).rejects.toThrow(new Error('OVERBOOKING_SCAN_FAILED'));
    expect(await count('overbooking_cases')).toBe(1);
    await runJob();
    expect(await count('overbooking_cases')).toBe(1);
    expect(await events('overbooking.case.opened')).toHaveLength(1);

    // Khởi động lại (client Prisma mới, tiến trình mới) vẫn hội tụ, không log thông điệp thô.
    const restarted = new PrismaClient({ datasourceUrl: testDb.ownerUrl });
    try {
      await runJob(restarted);
    } finally {
      await restarted.$disconnect();
    }
    expect(await count('overbooking_cases')).toBe(1);
    expect(JSON.stringify(logs)).not.toMatch(/boom|0900000127|HB127 Synthetic/);
  }, 90_000);

  test('HB127_persisted_scan_freshness_after_success_or_failure', async () => {
    await overbook(D, D1);
    expect(await runRows()).toHaveLength(0); // chưa quét lần nào ≠ quét xong mà rỗng

    // Đang chạy: RUNNING đã bền trước khi xử lý, chỉ thành SUCCEEDED sau khi commit xong.
    const held = interposed(testDb.db, 'gate');
    const running = runJob(held.proxy);
    for (
      let wait = 0;
      wait < 100 && (await count('overbooking_scan_runs', "status='RUNNING'")) === 0;
      wait += 1
    )
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(await count('overbooking_scan_runs', "status='RUNNING'")).toBe(1);
    expect(await count('overbooking_cases')).toBe(0);
    held.release();
    await running;
    const [ok] = await runRows();
    expect(ok?.status).toBe('SUCCEEDED');
    expect(new Date(text(ok?.finished_at)).toISOString()).toBe(TODAY.toISOString());

    // Lượt sau lỗi: có dòng FAILED kèm mã, dữ liệu và mốc thành công trước đó giữ nguyên.
    now = new Date('2026-12-04T03:00:00Z');
    await expect(runJob(interposed(testDb.db, 'before').proxy)).rejects.toThrow(
      'OVERBOOKING_SCAN_FAILED',
    );
    const all = await runRows();
    expect(all.map((row) => row.status)).toEqual(['SUCCEEDED', 'FAILED']);
    expect(all[1]?.failure_code).toBe('SCAN_FAILED');
    const lastSuccess = await rows(
      "SELECT max(finished_at) AS at FROM overbooking_scan_runs WHERE status='SUCCEEDED'",
    );
    expect(new Date(text(lastSuccess[0]?.at)).toISOString()).toBe(TODAY.toISOString());
    expect(await count('overbooking_cases')).toBe(1);
  }, 60_000);

  test('HB127_supported_server_composition_without_http_or_cycles', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8'));
    const exportsMap: unknown = Reflect.get(Object(manifest), 'exports');
    const entry: unknown = Reflect.get(Object(exportsMap), './worker-runtime/overbooking-scan.js');
    expect(entry).toEqual({
      'pinehill-dist': './dist/worker-runtime/overbooking-scan.js',
      default: './src/worker-runtime/overbooking-scan.ts',
    });
    // Composition server-only: không kéo HTTP/Nest app, không đọc env.
    const seam = readFileSync(
      join(root, 'apps/api/src/worker-runtime/overbooking-scan.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ''); // bỏ docblock: chỉ kiểm mã, không kiểm lời giải thích
    const specifiers = [...seam.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
    for (const specifier of specifiers)
      expect(specifier).not.toMatch(/app\.module|\/main\.|fastify|@nestjs|supertest/);
    expect(seam).not.toContain('process.env');
    // Phụ thuộc một chiều worker→API: API không import worker, worker không trỏ vào source API.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entryItem) =>
        entryItem.isDirectory()
          ? walk(join(dir, entryItem.name))
          : entryItem.name.endsWith('.ts')
            ? [join(dir, entryItem.name)]
            : [],
      );
    for (const file of walk(join(root, 'apps/api/src')))
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /from\s+'(@pinehill\/worker|(\.\.\/)+worker\/)/,
      );
    for (const file of walk(join(root, 'apps/worker/src')))
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /from\s+'[^']*apps\/api\/src|from\s+'(\.\.\/)+api\/src/,
      );
    const apiPackage = readFileSync(join(root, 'apps/api/package.json'), 'utf8');
    expect(apiPackage).not.toContain('@pinehill/worker');
  });
});

function buildWorkspace(): void {
  for (const filter of [
    '@pinehill/contracts',
    '@pinehill/domain',
    '@pinehill/api',
    '@pinehill/worker',
  ]) {
    const built = spawnSync('pnpm', ['--filter', filter, 'build'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env },
    });
    expect(built.status, `${filter} build\n${built.stderr}\n${built.stdout}`).toBe(0);
  }
}

const redisUrl = (): string => {
  const base = process.env.REDIS_URL;
  if (!base) throw new Error('HB-127 cần Redis 7 (REDIS_URL); không có nhánh bỏ qua');
  const url = new URL(base);
  url.pathname = '/5'; // DB 5: ticket này; Redis dev chỉ có DB 0–15
  return url.href;
};

async function until(
  check: () => Promise<boolean>,
  what: string,
  logsOf: () => string,
  ms = 90_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`HB127 dist worker: ${what} không xảy ra trong ${ms / 1000}s\n${logsOf()}`);
}

test('HB127_clean_build_dist_runtime_and_job_payload', async () => {
  buildWorkspace();
  expect(existsSync(join(root, 'apps/api/dist/worker-runtime/overbooking-scan.js'))).toBe(true);
  const distDb = await createOtaTestDb('overbooking_dist');
  const redis = new Redis(redisUrl());
  await redis.flushdb();
  const queue = new Queue(OVERBOOKING_SCAN_QUEUE, { connection: redisOptions(redisUrl()) });
  let captured = '';
  let worker: ReturnType<typeof spawn> | undefined;
  try {
    // Dữ kiện: quá tải 1 ca + setting nhịp 60 phút (khoá chính thức, nguồn SETTING).
    const one = async (sql: string, values: unknown[] = []) =>
      text((await distDb.rows(sql, values))[0]?.id);
    const property = await one(
      "INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES('H127-D','HB127','x','0900000000',0,0) RETURNING id",
    );
    const policy = await one(
      "INSERT INTO cancellation_policies(code,name) VALUES('H127','Synthetic') RETURNING id",
    );
    const rate = await one(
      "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('FLEX7','Synthetic',30,$1) RETURNING id",
      [policy],
    );
    const guest = await one('INSERT INTO guests(full_name,phone) VALUES($1,$2) RETURNING id', [
      GUEST.name,
      GUEST.phone,
    ]);
    const channel = await one(
      "INSERT INTO channels(code,name,multiplier) VALUES('WEB','WEB',1) RETURNING id",
    );
    const type = await one(
      "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','STD',2,100000,100000,200000) RETURNING id",
      [property],
    );
    await distDb.rows(
      "INSERT INTO rooms(property_id,room_type_id,code,name,bed_count) VALUES($1,$2,'R1','R1',1)",
      [property, type],
    );
    // Ngày nghiệp vụ tương lai gần theo đồng hồ thật của tiến trình dist.
    const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const next = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
    for (let index = 0; index < 2; index += 1) {
      const id = await one(
        `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,30,'CONFIRMED') RETURNING id`,
        [
          `PH-261201-${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`,
          guest,
          property,
          type,
          rate,
          channel,
          day,
          next,
        ],
      );
      await distDb.rows(
        'INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night) VALUES($1,$2,1,100000)',
        [id, type],
      );
    }
    await distDb.rows(
      "INSERT INTO system_settings(key,value,value_type) VALUES($1,'60','NUMBER')",
      [SCAN_INTERVAL_KEY],
    );

    worker = spawn(process.execPath, ['--conditions=pinehill-dist', 'dist/main.js'], {
      cwd: join(root, 'apps/worker'),
      env: {
        ...process.env,
        DATABASE_URL: distDb.ownerUrl,
        REDIS_URL: redisUrl(),
        LOG_LEVEL: 'info',
        ENABLE_REPEATABLE_SCHEDULERS: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [worker.stdout, worker.stderr])
      stream?.on('data', (chunk: Buffer) => {
        captured += chunk.toString('utf8');
      });

    // Nhịp 60 phút từ setting được đăng ký dưới đúng một identity.
    const schedulerEvery = async (): Promise<number | undefined> =>
      (await queue.getJobSchedulers()).find((entry) => entry.key === OVERBOOKING_SCAN_SCHEDULER_ID)
        ?.every ?? undefined;
    await until(
      async () => (await schedulerEvery()) === 3_600_000,
      'đăng ký nhịp 3.600.000 ms',
      () => captured,
    );

    // Job thủ công đi hết đường BullMQ → handler thật từ dist: hoàn tất, handler biết đúng jobId, và có ca thật.
    // Lịch BullMQ cũng bắn một lượt ngay khi đăng ký, nên có thể đã có lượt quét trước đó — hai lượt vẫn chỉ ra một ca.
    await queue.add(
      OVERBOOKING_SCAN_JOB,
      {},
      { jobId: 'hb127-dist-1', attempts: 1, removeOnComplete: false },
    );
    await until(
      async () => (await (await queue.getJob('hb127-dist-1'))?.isCompleted()) === true,
      'job thủ công hoàn tất',
      () => captured,
    );
    expect(captured).toContain('(job hb127-dist-1)');
    expect(await distDb.rows('SELECT id FROM overbooking_cases')).toHaveLength(1);
    expect(
      (await distDb.rows("SELECT id FROM overbooking_scan_runs WHERE status='SUCCEEDED'")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      await distDb.rows("SELECT id FROM overbooking_scan_runs WHERE status<>'SUCCEEDED'"),
    ).toHaveLength(0);

    // Đổi setting → worker cập nhật cùng identity, không redeploy, không nhân lịch.
    await distDb.rows('UPDATE system_settings SET value=$2 WHERE key=$1', [SCAN_INTERVAL_KEY, '5']);
    await until(
      async () => (await schedulerEvery()) === 300_000,
      'nhịp đổi sang 300.000 ms',
      () => captured,
      120_000,
    );
    expect(
      (await queue.getJobSchedulers()).filter(
        (entry) => entry.key === OVERBOOKING_SCAN_SCHEDULER_ID,
      ),
    ).toHaveLength(1);
    expect(captured).toContain(
      `nhịp quét quá tải 60 phút → 5 phút (scheduler ${OVERBOOKING_SCAN_SCHEDULER_ID}`,
    );

    expect(captured).not.toContain(GUEST.phone);
    expect(captured).not.toContain(GUEST.name);
    const exited = Promise.withResolvers<number | null>();
    worker.once('exit', (code) => exited.resolve(code));
    worker.kill('SIGTERM');
    expect(await exited.promise).toBe(0);
  } finally {
    if (worker !== undefined && worker.exitCode === null) worker.kill('SIGKILL');
    await queue.close();
    await redis.flushdb();
    redis.disconnect();
    await distDb.close();
  }
}, 420_000);
