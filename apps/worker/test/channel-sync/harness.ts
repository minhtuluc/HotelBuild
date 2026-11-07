/**
 * Harness test khoá HB-131 (giai đoạn A) cho worker: CSDL PostgreSQL 16 thật, Redis DB 12, worker chạy
 * bằng `defaultWorkerApp` (đúng dây nối production) và một **simulator OTA** ở ranh giới mạng.
 *
 * Hợp đồng giai đoạn A (B phải hiện thực đúng):
 * - Worker đọc địa chỉ simulator từ `system_settings['chan.ota.simulator.baseUrl']` (STRING) và gửi
 *   `POST` JSON tới base URL đó với thân `{channelId, channelCode, snapshot:{key, version, inventory}}`.
 *   Mã 2xx = đồng bộ thành công; khác 2xx/không kết nối = thất bại.
 * - Nhịp quét đọc `system_settings['job.channelSync.intervalSeconds']` (mặc định 300 giây).
 * - Job `q.channel-sync` nhận `data.key` (khoá idempotent của lượt chạy); chạy lại **cùng key** không
 *   tăng `consecutive_sync_failures` và không phát cảnh báo lần hai. `data.channelId` giới hạn lượt cho
 *   một kênh; `data.version` (khi có) là version ảnh chụp được chuyển nguyên vào `snapshot.version`.
 * - Ba kết quả thất bại riêng biệt liên tiếp ⇒ `channels.sync_status='DEGRADED'`,
 *   `consecutive_sync_failures=3`, `last_sync_error` đã che, cảnh báo MANAGER (notifications +
 *   `audit_logs.action='ALERT_RAISED'` với `condition='CHANNEL_DEGRADED'`).
 * - Một lượt thành công đã xác minh ⇒ `sync_status='OK'`, counter 0, `last_sync_at` mới, **giữ**
 *   `last_sync_error` cùng lịch sử cảnh báo/attempt.
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { z } from 'zod';
import { redisOptions } from '../../src/bullmq.factory.js';
import { loadWorkerConfig, type WorkerConfig } from '../../src/config/env.js';
import { defaultWorkerApp } from '../../src/main.js';
import type { WorkerApp } from '../../src/worker-app.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const CHANNEL_SYNC_QUEUE = 'q.channel-sync';
export const MANAGER_RECIPIENT = 'manager@pinehill.local';

export interface Capture {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

const captures: Capture[] = [];
let respondWith = 200;
let simulator: Server | undefined;
let owner: pg.Client | undefined;
let admin: pg.Client | undefined;
let runtimeUrl = '';
let redisUrl = '';
const apps: WorkerApp[] = [];
const dbName = `hb131w_${randomUUID().replaceAll('-', '')}`;
const dbRole = `hb131w_${randomUUID().replaceAll('-', '')}`;

export const seed: { propertyId: string; typeId: string; channels: Record<string, string> } = {
  propertyId: '',
  typeId: '',
  channels: {},
};

export const simulatorRequests = (): readonly Capture[] => captures;
export function simulatorRespond(status: number): void {
  respondWith = status;
}

export async function rows<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  if (owner === undefined) throw new Error('harness chưa setup');
  return (await owner.query<T>(sql, values)).rows;
}

async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

export function config(extra: Record<string, string> = {}): WorkerConfig {
  return loadWorkerConfig({
    DATABASE_URL: runtimeUrl,
    REDIS_URL: redisUrl,
    LOG_LEVEL: 'silent',
    WORKER_CONCURRENCY: '1',
    ENABLE_REPEATABLE_SCHEDULERS: 'true',
    ...extra,
  });
}

export async function setup(): Promise<void> {
  const migrationUrl = process.env['DATABASE_MIGRATION_URL'];
  if (!migrationUrl) throw new Error('HB-131 cần PostgreSQL 16; thiếu DATABASE_MIGRATION_URL');
  admin = new pg.Client({ connectionString: migrationUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const ownerUrl = new URL(migrationUrl);
  ownerUrl.pathname = `/${dbName}`;
  const migration = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl.href, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  if (migration.status !== 0) throw new Error(`migrate thất bại: ${migration.stderr}`);
  owner = new pg.Client({ connectionString: ownerUrl.href });
  await owner.connect();
  const pass = randomBytes(24).toString('hex');
  const quoted = (
    await admin.query<{ literal: string }>('SELECT quote_literal($1) AS literal', [pass])
  ).rows[0]!.literal;
  await admin.query(`CREATE ROLE "${dbRole}" LOGIN INHERIT PASSWORD ${quoted}`);
  await admin.query(`GRANT app_rw TO "${dbRole}"`);
  const runtime = new URL(ownerUrl);
  runtime.username = dbRole;
  runtime.password = pass;
  runtimeUrl = runtime.href;
  const parsedRedis = new URL(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379');
  parsedRedis.pathname = '/12';
  redisUrl = parsedRedis.href;

  seed.propertyId = await insert(
    "INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES('CS-01','Cơ sở 1','Synthetic','+84900000131',10.7769,106.7009) RETURNING id",
  );
  seed.typeId = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Standard',2,500000,400000,900000) RETURNING id",
    [seed.propertyId],
  );
  for (const code of ['R1', 'R2', 'R3', 'R4', 'R5'])
    await insert(
      'INSERT INTO rooms(property_id,room_type_id,code,name) VALUES($1,$2,$3,$3) RETURNING id',
      [seed.propertyId, seed.typeId, code],
    );
  for (const code of ['WEB', 'OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'])
    seed.channels[code] = await insert(
      'INSERT INTO channels(code,name,multiplier) VALUES($1,$1,1) RETURNING id',
      [code],
    );
  for (const code of ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'])
    await rows(
      'INSERT INTO channel_mappings(channel_id,room_type_id,external_room_code) VALUES($1,$2,$3)',
      [seed.channels[code], seed.typeId, `STD-${code}`],
    );

  simulator = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = raw;
      try {
        body = z.unknown().parse(JSON.parse(raw));
      } catch {
        body = raw;
      }
      captures.push({ method: request.method ?? '', url: request.url ?? '', body });
      response.statusCode = respondWith;
      response.end(JSON.stringify({ ok: respondWith < 400 }));
    });
  });
  const listening = Promise.withResolvers<number>();
  simulator.listen(0, '127.0.0.1', () => {
    const address = simulator?.address();
    if (address === null || address === undefined || typeof address === 'string')
      throw new Error('simulator không có cổng TCP');
    listening.resolve(address.port);
  });
  const port = await listening.promise;
  for (const [key, value, type] of [
    ['job.channelSync.intervalSeconds', '300', 'NUMBER'],
    ['channel.lowInventoryThreshold', '2', 'NUMBER'],
    ['chan.ota.simulator.baseUrl', `http://127.0.0.1:${port}`, 'STRING'],
    ['alerts.recipient.manager', MANAGER_RECIPIENT, 'STRING'],
  ] as const)
    await rows(
      'INSERT INTO system_settings(key,value,value_type) VALUES($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
      [key, value, type],
    );

  const redis = new Redis(redisUrl);
  await redis.flushdb();
  await redis.quit();
  const queue = new Queue(CHANNEL_SYNC_QUEUE, { connection: redisOptions(redisUrl) });
  await queue.obliterate({ force: true });
  await queue.close();
}

export async function teardown(): Promise<void> {
  for (const app of apps.splice(0)) await app.stop();
  if (simulator) {
    const closed = Promise.withResolvers<void>();
    simulator.close(() => closed.resolve());
    await closed.promise;
  }
  await owner?.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin?.end();
}

export async function startWorker(extra: Record<string, string> = {}): Promise<WorkerApp> {
  const app = defaultWorkerApp(config(extra));
  apps.push(app);
  await app.start();
  return app;
}

export async function stopWorker(app: WorkerApp): Promise<void> {
  const index = apps.indexOf(app);
  if (index >= 0) apps.splice(index, 1);
  await app.stop();
}

function queue(): Queue {
  return new Queue(CHANNEL_SYNC_QUEUE, { connection: redisOptions(redisUrl) });
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function settle(job: Job): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') return;
    if (Date.now() > deadline) throw new Error(`job q.channel-sync không chạy xong (${state})`);
    await delay(50);
  }
}

/**
 * Chạy một lượt quét `q.channel-sync` với khoá idempotent của lượt. Chạy lại cùng `key` phải là lượt
 * phát lại, không phải thất bại mới.
 */
export async function runSweep(key: string, data: Record<string, unknown> = {}): Promise<void> {
  const client = queue();
  try {
    const job = await client.add(
      'channel-sync',
      { key, ...data },
      { jobId: `hb131-${key}`, removeOnComplete: false, removeOnFail: false },
    );
    await settle(job);
  } finally {
    await client.close();
  }
}

export async function schedulers(): Promise<
  readonly { id?: string | null; name: string; every?: number }[]
> {
  const client = queue();
  try {
    return await client.getJobSchedulers();
  } finally {
    await client.close();
  }
}

export async function channelState(code: string): Promise<{
  sync_status: string;
  consecutive_sync_failures: number;
  last_sync_error: string | null;
  last_sync_at: Date | null;
}> {
  const found = await rows<{
    sync_status: string;
    consecutive_sync_failures: number;
    last_sync_error: string | null;
    last_sync_at: Date | null;
  }>(
    'SELECT sync_status, consecutive_sync_failures, last_sync_error, last_sync_at FROM channels WHERE id=$1',
    [seed.channels[code]],
  );
  return found[0]!;
}

export async function alertCount(): Promise<number> {
  return Number(
    (
      await rows(
        "SELECT count(*) AS n FROM audit_logs WHERE action='ALERT_RAISED' AND after_json->>'condition'='CHANNEL_DEGRADED'",
      )
    )[0]!.n,
  );
}

/** Thân request đã kiểm bằng zod (không dùng `as` cho `unknown` từ simulator). */
export const snapshotCaptureSchema = z.object({
  channelId: z.string().optional(),
  channelCode: z.string().optional(),
  snapshot: z
    .object({
      key: z.string().optional(),
      version: z.number().optional(),
      inventory: z.array(z.unknown()).optional(),
    })
    .optional(),
});

export type SnapshotCapture = z.infer<typeof snapshotCaptureSchema>;

export function snapshotBodies(): readonly SnapshotCapture[] {
  return simulatorRequests().flatMap((capture) => {
    const parsed = snapshotCaptureSchema.safeParse(capture.body);
    return parsed.success ? [parsed.data] : [];
  });
}
