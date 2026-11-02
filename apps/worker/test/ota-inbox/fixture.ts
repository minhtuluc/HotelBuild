/**
 * Fixture HB-129 worker (giai đoạn A) — PostgreSQL16 tạm, Redis `/13`, và **cổng gọi job thật**
 * `q.ota-inbox` qua `JOB_HANDLERS`.
 *
 * Hợp đồng đã pin cho giai đoạn B (worker):
 * - `QUEUE_NAMES` có `q.ota-inbox`; `JOB_HANDLERS['q.ota-inbox']` là `JobHandler` hiện thực.
 * - `job.data = {}` nghĩa là **quét** mọi hàng đến hạn: `PENDING`/`FAILED` có `available_at <= now`,
 *   và `PROCESSING` có lease đã hết hạn. `job.data = { eventId }` chỉ áp đúng hàng đó.
 * - Claim bằng CAS lease trong cùng transaction nghiệp vụ; hoàn tất đóng `PROCESSED`, lỗi tạm thời
 *   đóng `FAILED` + lùi `available_at`, lượt cuối (`attempt >= attempts`) đóng `DEAD_LETTER` và
 *   **giữ nguyên** `payload_json`.
 * - `last_error` là mã ngắn `[A-Z][A-Z0-9_]+`, không payload/PII (store HB-095).
 *
 * Không có nhánh bỏ qua khi thiếu CSDL/Redis: luồng inbox bền phải chạy trên hạ tầng thật.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { loadWorkerConfig } from '../../src/config/env.js';
import { JOB_HANDLERS } from '../../src/jobs/registry.js';
import type { JobContext, JobHandler } from '../../src/jobs/types.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

/** Hàng đợi HB-129 (HB-127 đặt tên cùng quy ước `q.<domain>`). */
export const OTA_INBOX_QUEUE = 'q.ota-inbox';

/** Mã ngắn cho `last_error`; khớp docblock `InboxOutcome` của store HB-095. */
export const SHORT_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,60}$/;

export const REFERENCE = {
  propertyCode: 'H129-A',
  accountId: 'hb129-worker-account',
  channelCode: 'OTA_BOOKING',
  checkIn: '2026-12-13',
  checkOut: '2026-12-15',
  amount: 200_000,
  guestName: 'HB129 Worker Guest',
  guestPhone: '0900000129',
} as const;

export interface OtaTestDb {
  readonly ownerUrl: string;
  readonly db: PrismaClient;
  rows(sql: string, values?: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

export async function createOtaTestDb(label: string): Promise<OtaTestDb> {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  if (!migrationUrl)
    throw new Error('HB-129 cần PostgreSQL16 (DATABASE_MIGRATION_URL); không có nhánh bỏ qua');
  const name = `hb129_${label}_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: migrationUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const target = new URL(migrationUrl);
  target.pathname = `/${name}`;
  const ownerUrl = target.href;
  const migration = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  if (migration.status !== 0)
    throw new Error(`HB-129 migrate thất bại: ${(migration.stderr ?? '').slice(-500)}`);
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  const db = new PrismaClient({ datasourceUrl: ownerUrl });
  return {
    ownerUrl,
    db,
    rows: async (sql, values = []) =>
      (await owner.query<Record<string, unknown>>(sql, values)).rows,
    close: async () => {
      await db.$disconnect();
      await owner.end();
      const dropper = new pg.Client({ connectionString: migrationUrl });
      await dropper.connect();
      try {
        await dropper.query(`DROP DATABASE IF EXISTS "${name}" WITH(FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

/** Redis DB `/13` (ticket này) — số DB do lead phân, không dùng DB mặc định của máy. */
export function testRedisUrl(): string {
  const base = process.env.REDIS_URL;
  if (!base) throw new Error('HB-129 cần Redis7 (REDIS_URL); không có nhánh bỏ qua');
  const url = new URL(base);
  url.pathname = '/13';
  return url.href;
}

export interface WorkerReference {
  readonly propertyId: string;
  readonly channelId: string;
  readonly channel: string;
}

/** Dữ kiện tối thiểu để một event OTA có thể đi hết đường giá/ánh xạ khi B hiện thực. */
export async function seedWorkerReference(rows: OtaTestDb['rows']): Promise<WorkerReference> {
  const insert = async (sql: string, values: unknown[] = []): Promise<string> =>
    text((await rows(sql, values))[0]?.id);
  const propertyId = await insert(
    `INSERT INTO properties(code,name,address,phone,latitude,longitude)
     VALUES($1,'HB129 synthetic','HB129 address','0900000000',0,0) RETURNING id`,
    [REFERENCE.propertyCode],
  );
  const policyId = await insert(
    "INSERT INTO cancellation_policies(code,name) VALUES('H034','HB129 synthetic') RETURNING id",
  );
  await rows('UPDATE cancellation_policies SET is_default=true WHERE id=$1::uuid', [policyId]);
  await rows(
    `INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id)
     VALUES('FLEX7','HB129 flexible',30,$1)`,
    [policyId],
  );
  const std = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price)
     VALUES($1,'STD','Standard',2,100000,100000,200000) RETURNING id`,
    [propertyId],
  );
  const dorm = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price,allow_shared)
     VALUES($1,'DOR','Dorm',2,100000,100000,200000,true) RETURNING id`,
    [propertyId],
  );
  for (const code of ['R1', 'R2']) {
    await rows(
      'INSERT INTO rooms(property_id,room_type_id,code,name,bed_count) VALUES($1,$2,$3,$3,1)',
      [propertyId, std, code],
    );
  }
  await rows(
    "INSERT INTO rooms(property_id,room_type_id,code,name,bed_count) VALUES($1,$2,'D1','D1',6)",
    [propertyId, dorm],
  );
  const channel = await insert(
    "INSERT INTO channels(code,name,multiplier) VALUES('OTA_BOOKING','OTA',1) RETURNING id",
  );
  for (const [code, typeId] of [
    ['STD', std],
    ['DOR', dorm],
  ] as const) {
    await rows(
      'INSERT INTO channel_mappings(channel_id,room_type_id,external_room_code) VALUES($1,$2,$3)',
      [channel, typeId, code],
    );
  }
  await rows(
    `INSERT INTO system_settings(key,value,value_type) VALUES('pricing.weekendMultiplier','1.00','NUMBER')
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
  );
  return { propertyId, channelId: channel, channel: REFERENCE.channelCode };
}

export interface InboxInput {
  readonly eventId: string;
  readonly code: string;
  readonly eventType?: 'booking.created' | 'booking.modified' | 'booking.cancelled';
  readonly updatedAt?: string;
  readonly accountId?: string;
  readonly checkIn?: string;
  readonly checkOut?: string;
  readonly roomTypeCode?: string;
  readonly propertyCode?: string;
  readonly guestName?: string;
  readonly guestPhone?: string;
  readonly amount?: number;
  readonly roomCount?: number;
  readonly adults?: number;
  readonly paymentCollected?: boolean;
}

/** Mặc định tường minh: giữ độ phức tạp của `payloadOf` dưới ngưỡng lint. */
function pick<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

/** Payload **đã chuẩn hoá** đúng `normalizeEvent` của HB-128 — worker chỉ đọc `payload_json`. */
export function payloadOf(input: InboxInput): Record<string, unknown> {
  return {
    channelCode: REFERENCE.channelCode,
    eventType: pick(input.eventType, 'booking.cancelled'),
    providerAccountId: pick(input.accountId, REFERENCE.accountId),
    providerBookingCode: input.code,
    providerUpdatedAt: pick(input.updatedAt, '2026-12-01T00:00:00.000Z'),
    propertyCode: pick(input.propertyCode, REFERENCE.propertyCode),
    roomTypeCode: pick(input.roomTypeCode, 'STD'),
    checkIn: pick(input.checkIn, REFERENCE.checkIn),
    checkOut: pick(input.checkOut, REFERENCE.checkOut),
    adults: pick(input.adults, 2),
    children: 0,
    roomCount: pick(input.roomCount, 1),
    guest: {
      fullName: pick(input.guestName, REFERENCE.guestName),
      phone: pick(input.guestPhone, REFERENCE.guestPhone),
    },
    amount: pick(input.amount, REFERENCE.amount),
    currency: 'VND',
    paymentCollected: pick(input.paymentCollected, true),
    note: null,
  };
}

export interface InboxRowSeed {
  readonly eventId: string;
  readonly inboxId: string;
}

export async function insertInbox(
  rows: OtaTestDb['rows'],
  input: InboxInput,
): Promise<InboxRowSeed> {
  const payload = payloadOf(input);
  const inserted = await rows(
    `INSERT INTO webhook_inbox(provider,provider_account_id,event_id,payload_hash,payload_json,
       signature_verified_at,available_at,created_at,updated_at)
     VALUES('booking',$1,$2,$3,$4,clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp())
     RETURNING id`,
    [
      input.accountId ?? REFERENCE.accountId,
      input.eventId,
      hashOf(payload),
      JSON.stringify(payload),
    ],
  );
  return { eventId: input.eventId, inboxId: text(inserted[0]?.id) };
}

/** Cùng thuật toán hash của HB-128 (`sha256` trên JSON chuẩn hoá). */
export function hashOf(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export interface WorkerHarness {
  readonly context: JobContext;
  readonly logs: string[];
}

/** Ngữ cảnh job thật của worker; `clock` tất định để kiểm lease hết hạn/hợp lệ. */
export function makeContext(
  db: PrismaClient,
  ownerUrl: string,
  now = new Date('2026-12-01T00:00:00.000Z'),
): WorkerHarness {
  const logs: string[] = [];
  const config = loadWorkerConfig({
    DATABASE_URL: ownerUrl,
    REDIS_URL: testRedisUrl(),
    LOG_LEVEL: 'silent',
    ENABLE_REPEATABLE_SCHEDULERS: 'false',
  });
  const context: JobContext = {
    db,
    config,
    clock: { now: () => now },
    log: ({ queue, msg, jobId, errorCode }) => {
      logs.push(`${errorCode === undefined ? 'info' : 'error'}|${queue}|${jobId ?? '-'}|${msg}`);
    },
  };
  return { context, logs };
}

function isHandler(value: unknown): value is JobHandler {
  return typeof value === 'function';
}

/** Cổng gọi job `q.ota-inbox`; thiếu đăng ký ⇒ đỏ có chủ đích, không lỗi import cả file. */
export function otaInboxHandler(): JobHandler {
  const found: unknown = Reflect.get(JOB_HANDLERS, OTA_INBOX_QUEUE);
  if (!isHandler(found))
    throw new Error(
      `GIAI ĐOẠN A ĐỎ CÓ CHỦ ĐÍCH: JOB_HANDLERS chưa đăng ký ${OTA_INBOX_QUEUE} ` +
        '(HB-129 giai đoạn B phải nối handler vào jobs/registry.ts và QUEUE_NAMES)',
    );
  return found;
}

/** Đổi tên bảng đang chạy rồi đổi lại — lỗi ghi thật, không mock (mẫu HB-128 `fault.ts`). */
export class TableOutage {
  private constructor(
    private readonly table: string,
    private readonly label: string,
  ) {}

  static async start(rows: OtaTestDb['rows'], table: string, label: string): Promise<TableOutage> {
    await rows(`ALTER TABLE ${table} RENAME TO ${table}_${label}`);
    return new TableOutage(table, label);
  }

  async restore(rows: OtaTestDb['rows']): Promise<void> {
    await rows(`ALTER TABLE ${this.table}_${this.label} RENAME TO ${this.table}`);
  }
}

export function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  throw new Error(`HB129 expected text-like, got ${typeof value}`);
}

export function count(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Error(`HB129 expected integer-like, got ${String(value)}`);
}

export function one(list: readonly Record<string, unknown>[]): Record<string, unknown> {
  const [row] = list;
  if (row === undefined) throw new Error('HB129 expected exactly one row');
  return row;
}

export function instantOf(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  throw new Error(`HB129 expected timestamp-like, got ${String(value)}`);
}

export const inboxOf = (rows: OtaTestDb['rows'], eventId: string) =>
  rows('SELECT * FROM webhook_inbox WHERE event_id=$1', [eventId]);
