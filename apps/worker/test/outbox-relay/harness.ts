import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { loadWorkerConfig } from '../../src/config/env.js';
import type { JobContext } from '../../src/jobs/types.js';
import type { OutboxConsumer } from '../../src/jobs/outbox-relay/consumer.js';
import { OutboxConsumerError } from '../../src/jobs/outbox-relay/consumer.js';
import type { OutboxEnvelope } from '../../src/jobs/outbox-relay/envelope.js';

/**
 * Hạ tầng test HB-130: PostgreSQL16 thật (CSDL riêng mỗi file, migrate bằng `scripts/migrate.mjs`) và một
 * bảng **fixture** `hb130_effects` mô phỏng tác dụng nghiệp vụ của consumer: khoá chính `(consumer, event_id)`
 * là đúng cách consumer tự dedup theo ADR-017 — ghi lặp cùng sự kiện không sinh bản ghi thứ hai.
 */
const root = fileURLToPath(new URL('../../../../', import.meta.url));

const EFFECTS_DDL = `
CREATE TABLE hb130_effects (
  consumer     text NOT NULL,
  event_id     uuid NOT NULL,
  event_type   text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
)`;

export interface OutboxTestDb {
  readonly ownerUrl: string;
  readonly db: PrismaClient;
  rows(sql: string, values?: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

export async function createOutboxTestDb(label: string): Promise<OutboxTestDb> {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  if (!migrationUrl)
    throw new Error('HB-130 cần PostgreSQL16 (DATABASE_MIGRATION_URL); không có nhánh bỏ qua');
  const dbName = `hb130_${label}_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: migrationUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  const target = new URL(migrationUrl);
  target.pathname = `/${dbName}`;
  const ownerUrl = target.href;
  const migration = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  if (migration.status !== 0)
    throw new Error(`migrate thất bại: ${(migration.stderr ?? '').slice(-500)}`);
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query(EFFECTS_DDL);
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
        await dropper.query(`DROP DATABASE IF EXISTS "${dbName}" WITH(FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

/** Đồng hồ tiêm được: relay lấy **mọi** mốc thời gian từ đây nên test điều khiển được hạn lease/backoff. */
export interface FakeClock {
  now(): Date;
  advance(milliseconds: number): void;
}

export function fakeClock(start: string): FakeClock {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    advance: (milliseconds) => {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}

export interface EventFixture {
  readonly eventType?: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly payload?: unknown;
  readonly availableAt?: Date;
  readonly createdAt?: Date;
  readonly status?: string;
}

export async function insertOutboxEvent(
  db: PrismaClient,
  fixture: EventFixture = {},
): Promise<string> {
  const id = randomUUID();
  const createdAt = fixture.createdAt ?? new Date('2026-11-05T00:00:00Z');
  await db.$executeRaw`
    INSERT INTO outbox_events(id, event_type, aggregate_type, aggregate_id, payload_json,
                              available_at, created_at, status)
    VALUES (${id}::uuid, ${fixture.eventType ?? FIXTURE_EVENT_TYPE},
            ${fixture.aggregateType ?? 'RoomType'}, ${fixture.aggregateId ?? randomUUID()}::uuid,
            ${JSON.stringify(fixture.payload ?? { schemaVersion: 1 })}::jsonb,
            ${fixture.availableAt ?? createdAt}, ${createdAt}, ${fixture.status ?? 'PENDING'})`;
  return id;
}

/** Hàng delivery chưa qua relay (mô phỏng lượt trước đã đăng ký nhưng chưa chốt). */
export async function insertDelivery(
  db: PrismaClient,
  consumer: string,
  eventId: string,
): Promise<void> {
  await db.$executeRaw`
    INSERT INTO event_deliveries(event_id, consumer) VALUES (${eventId}::uuid, ${consumer})`;
}

export interface HarnessContext {
  readonly context: JobContext;
  readonly logs: string[];
}

export function makeContext(db: PrismaClient, clock: FakeClock, ownerUrl: string): HarnessContext {
  const logs: string[] = [];
  return {
    logs,
    context: {
      db,
      config: loadWorkerConfig({
        DATABASE_URL: ownerUrl,
        REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:56379',
        LOG_LEVEL: 'silent',
      }),
      clock,
      log: ({ queue, msg }) => logs.push(`${queue}|${msg}`),
    },
  };
}

export interface RecorderOptions {
  /** Loại sự kiện được nhận; bỏ trống ⇒ `[FIXTURE_EVENT_TYPE]` (khớp mặc định của `insertOutboxEvent`). */
  readonly eventTypes?: readonly string[];
  /** Số lượt đầu ném lỗi (ghi tác dụng **trước** khi ném, mô phỏng chết sau khi đã gây tác dụng). */
  readonly failFirst?: number;
  /** Lỗi thô mang PII trong `message` để chứng minh mã lỗi lưu bền đã được che. */
  readonly rawError?: boolean;
}

export interface Recorder {
  readonly consumer: OutboxConsumer;
  readonly calls: OutboxEnvelope[];
}

/** Loại sự kiện mặc định của fixture — khớp `insertOutboxEvent` khi test không ghi rõ. */
export const FIXTURE_EVENT_TYPE = 'InventoryChanged';

/** Mã lỗi fixture **thuộc danh mục** `@pinehill/contracts`: consumer chỉ được ném mã trong danh mục. */
export const FIXTURE_FAILURE_CODE = 'E_GEN_SERVICE_UNAVAILABLE';

/**
 * Consumer kiểm soát được: ghi tác dụng idempotent vào `hb130_effects` rồi (tuỳ chọn) ném lỗi. `calls` đếm
 * số lượt relay thực sự gọi handler — at-least-once, nên có thể lớn hơn số hàng tác dụng.
 */
export function recordingConsumer(
  db: PrismaClient,
  name: string,
  options: RecorderOptions = {},
): Recorder {
  const calls: OutboxEnvelope[] = [];
  return {
    calls,
    consumer: {
      name,
      version: 1,
      eventTypes: options.eventTypes ?? [FIXTURE_EVENT_TYPE],
      handle: async (envelope) => {
        calls.push(envelope);
        await db.$executeRaw`
          INSERT INTO hb130_effects(consumer, event_id, event_type, payload_json)
          VALUES (${name}, ${envelope.eventId}::uuid, ${envelope.eventType},
                  ${JSON.stringify(envelope.payload)}::jsonb)
          ON CONFLICT (consumer, event_id) DO NOTHING`;
        if (options.failFirst !== undefined && calls.length <= options.failFirst) {
          throw options.rawError === true
            ? new Error('lỗi thô có PII: khach 0905123456 token=secret-abc')
            : new OutboxConsumerError(FIXTURE_FAILURE_CODE);
        }
      },
    },
  };
}

/** Cột `event_deliveries` mà test cần xác nhận (khớp đúng truy vấn bên dưới). */
export interface DeliveryRow {
  readonly status: string;
  readonly attempts: number;
  readonly lease_token: string | null;
  readonly lease_expires_at: Date | null;
  readonly completed_at: Date | null;
  readonly last_error: string | null;
}

export async function deliveryRow(
  db: PrismaClient,
  consumer: string,
  eventId: string,
): Promise<DeliveryRow> {
  const [row] = await db.$queryRaw<DeliveryRow[]>`
    SELECT status, attempts, lease_token, lease_expires_at, completed_at, last_error
      FROM event_deliveries WHERE consumer = ${consumer} AND event_id = ${eventId}::uuid`;
  if (row === undefined) throw new Error('cần đúng một hàng delivery nhưng không thấy hàng nào');
  return row;
}
