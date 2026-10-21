import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { loadWorkerConfig } from '../../src/config/env.js';
import type { WorkerConfig } from '../../src/config/env.js';
import type { JobContext } from '../../src/jobs/types.js';
import { onlyRow } from './seed.js';
import type { NoShowFixture } from './seed.js';

/**
 * Hạ tầng test HB-147: PostgreSQL16 thật (CSDL riêng mỗi file, migrate bằng `scripts/migrate.mjs`), ngữ
 * cảnh job và ảnh chụp trạng thái sau lượt quét. Dữ liệu mẫu nằm ở `seed.ts`.
 *
 * Không có nhánh bỏ qua khi thiếu CSDL: đánh dấu no-show là nghiệp vụ tiền/tồn, phải chạy trên PG thật.
 */
const root = fileURLToPath(new URL('../../../../', import.meta.url));

export interface NoShowTestDb {
  readonly ownerUrl: string;
  readonly db: PrismaClient;
  rows(sql: string, values?: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

export async function createNoShowTestDb(label: string): Promise<NoShowTestDb> {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  if (!migrationUrl)
    throw new Error('HB-147 cần PostgreSQL16 (DATABASE_MIGRATION_URL); không có nhánh bỏ qua');
  const dbName = `hb147_${label}_${randomUUID().replaceAll('-', '')}`;
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
        await dropper.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

export interface NoShowHarness {
  readonly context: JobContext;
  readonly logs: string[];
  config(over: Partial<WorkerConfig>): WorkerConfig;
}

export function makeNoShowContext(
  db: PrismaClient,
  ownerUrl: string,
  over: Partial<WorkerConfig> = {},
): NoShowHarness {
  const logs: string[] = [];
  const config = loadWorkerConfig({
    DATABASE_URL: ownerUrl,
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    LOG_LEVEL: 'silent',
    ENABLE_REPEATABLE_SCHEDULERS: 'false',
  });
  const merged: WorkerConfig = { ...config, ...over };
  return {
    logs,
    config: (extra) => ({ ...merged, ...extra }),
    context: {
      db,
      config: merged,
      // Đồng hồ tiến trình cố ý lệch: mọi quyết định mốc phải lấy giờ CSDL (BR-BOOK-18).
      clock: { now: () => new Date('2099-01-01T00:00:00.000Z') },
      log: ({ queue, msg, jobId, errorCode }) =>
        logs.push(`${errorCode === undefined ? 'info' : 'error'}|${queue}|${jobId ?? '-'}|${msg}`),
    },
  };
}

export interface NoShowState {
  readonly status: string;
  readonly totalAmount: string;
  readonly penaltyAmount: string;
  readonly paidAmount: string;
  readonly balanceDue: string;
  readonly activeAssignments: number;
  readonly releaseReasons: string[];
  readonly history: { from: string | null; to: string; reason: string | null }[];
  readonly audit: { action: string; actorRole: string; actorId: string | null; after: unknown }[];
  readonly outbox: { eventType: string; operation: string | null; roomIds: string[] }[];
  readonly penaltyCharges: { amount: string; voidedAmount: string }[];
  readonly penaltyPayments: { status: string; method: string; amount: string }[];
  readonly roomVoided: string;
}

/** Ảnh chụp mọi thứ lượt quét phải đổi **cùng transaction** (BR-CANCEL-10, BR-GEN-07). */
export async function noShowState(db: PrismaClient, fixture: NoShowFixture): Promise<NoShowState> {
  const booking = onlyRow(
    await db.$queryRaw<
      {
        status: string;
        total_amount: bigint;
        penalty_amount: bigint;
        paid_amount: bigint;
        balance_due: bigint;
      }[]
    >`
      SELECT status, total_amount, penalty_amount, paid_amount, balance_due
        FROM bookings WHERE id = ${fixture.bookingId}::uuid`,
    'booking',
  );
  const assignments = onlyRow(
    await db.$queryRaw<{ active: bigint; released: bigint }[]>`
      SELECT count(*) FILTER (WHERE released_at IS NULL) AS active,
             count(*) FILTER (WHERE released_at IS NOT NULL) AS released
        FROM room_assignments a
        JOIN booking_rooms br ON br.id = a.booking_room_id
       WHERE br.booking_id = ${fixture.bookingId}::uuid`,
    'phân công',
  );
  const reasons = await db.$queryRaw<{ release_reason: string | null }[]>`
    SELECT release_reason FROM room_assignments a
      JOIN booking_rooms br ON br.id = a.booking_room_id
     WHERE br.booking_id = ${fixture.bookingId}::uuid AND released_at IS NOT NULL`;
  const history = await db.$queryRaw<
    { from_status: string | null; to_status: string; reason: string | null }[]
  >`
    SELECT from_status, to_status, reason FROM booking_status_history
     WHERE booking_id = ${fixture.bookingId}::uuid ORDER BY at`;
  const audit = await db.$queryRaw<
    { action: string; actor_role: string; actor_id: string | null; after_json: unknown }[]
  >`
    SELECT action, actor_role, actor_id, after_json FROM audit_logs
     WHERE entity_type = 'Booking' AND entity_id = ${fixture.bookingId}::uuid ORDER BY chain_seq`;
  const outbox = await db.$queryRaw<
    { event_type: string; payload_json: { operation?: string; roomIds?: string[] } }[]
  >`
    SELECT event_type, payload_json FROM outbox_events
     WHERE aggregate_type = 'Booking' AND aggregate_id = ${fixture.bookingId}::uuid
     ORDER BY created_at`;
  const penaltyCharges = await db.$queryRaw<{ amount: bigint; voided_amount: bigint }[]>`
    SELECT amount, voided_amount FROM booking_charges
     WHERE booking_id = ${fixture.bookingId}::uuid AND kind = 'PENALTY' ORDER BY id`;
  const penaltyPayments = await db.$queryRaw<{ status: string; method: string; amount: bigint }[]>`
    SELECT status, method, amount FROM payments
     WHERE booking_id = ${fixture.bookingId}::uuid AND type = 'PENALTY' ORDER BY id`;
  const roomVoided = onlyRow(
    await db.$queryRaw<{ voided: bigint }[]>`
      SELECT coalesce(sum(amount - voided_amount), 0) AS voided FROM booking_charges
       WHERE booking_id = ${fixture.bookingId}::uuid AND kind = 'ROOM'`,
    'nghĩa vụ phòng',
  );
  return {
    status: booking.status,
    totalAmount: booking.total_amount.toString(),
    penaltyAmount: booking.penalty_amount.toString(),
    paidAmount: booking.paid_amount.toString(),
    balanceDue: booking.balance_due.toString(),
    activeAssignments: Number(assignments.active),
    releaseReasons: reasons.map((row) => row.release_reason ?? ''),
    history: history.map((row) => ({
      from: row.from_status,
      to: row.to_status,
      reason: row.reason,
    })),
    audit: audit.map((row) => ({
      action: row.action,
      actorRole: row.actor_role,
      actorId: row.actor_id,
      after: row.after_json,
    })),
    outbox: outbox.map((row) => ({
      eventType: row.event_type,
      operation: row.payload_json.operation ?? null,
      roomIds: row.payload_json.roomIds ?? [],
    })),
    penaltyCharges: penaltyCharges.map((row) => ({
      amount: row.amount.toString(),
      voidedAmount: row.voided_amount.toString(),
    })),
    penaltyPayments: penaltyPayments.map((row) => ({
      status: row.status,
      method: row.method,
      amount: row.amount.toString(),
    })),
    roomVoided: roomVoided.voided.toString(),
  };
}
