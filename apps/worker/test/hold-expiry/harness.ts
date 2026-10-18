import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import pg from 'pg';
import { loadWorkerConfig } from '../../src/config/env.js';
import type { WorkerConfig } from '../../src/config/env.js';
import type { JobContext } from '../../src/jobs/types.js';

/**
 * Hạ tầng test HB-078: PostgreSQL16 thật (CSDL riêng mỗi file, migrate bằng `scripts/migrate.mjs`) và các
 * helper dựng một hold tối thiểu (`properties` → `room_types` → `rooms` → `bookings` → `booking_rooms` →
 * `room_assignments` + `channel_allotments`).
 *
 * Không có nhánh bỏ qua khi thiếu CSDL: luồng hết hạn là nghiệp vụ tồn phòng, phải chạy trên PG thật
 * (cùng lối với hạ tầng HB-130).
 */
const root = fileURLToPath(new URL('../../../../', import.meta.url));

export interface HoldTestDb {
  readonly ownerUrl: string;
  readonly db: PrismaClient;
  rows(sql: string, values?: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

export async function createHoldTestDb(label: string): Promise<HoldTestDb> {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  if (!migrationUrl)
    throw new Error('HB-078 cần PostgreSQL16 (DATABASE_MIGRATION_URL); không có nhánh bỏ qua');
  const dbName = `hb078_${label}_${randomUUID().replaceAll('-', '')}`;
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
        await dropper.query(`DROP DATABASE IF EXISTS "${dbName}" WITH(FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

/**
 * Đồng hồ **tiến trình** cố ý đặt xa tương lai: mọi quyết định hết hạn phải lấy giờ từ CSDL
 * (`clock_timestamp()`, BR-BOOK-18) nên hold chưa đến hạn vẫn không bị đụng dù đồng hồ app đã qua 2099.
 */
export const FAR_FUTURE = new Date('2099-01-01T00:00:00.000Z');

export interface HoldHarness {
  readonly context: JobContext;
  readonly logs: string[];
  config(over: Partial<WorkerConfig>): WorkerConfig;
}

export function makeHoldContext(
  db: PrismaClient,
  ownerUrl: string,
  over: Partial<WorkerConfig> = {},
): HoldHarness {
  const logs: string[] = [];
  const config = loadWorkerConfig({
    DATABASE_URL: ownerUrl,
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    LOG_LEVEL: 'silent',
    // Nhịp lặp do BullMQ giữ ở Redis; test tự gọi handler nên không bật scheduler (xem `redis.integration`).
    ENABLE_REPEATABLE_SCHEDULERS: 'false',
  });
  const merged: WorkerConfig = { ...config, ...over };
  return {
    logs,
    config: (extra) => ({ ...merged, ...extra }),
    context: {
      db,
      config: merged,
      clock: { now: () => new Date(FAR_FUTURE) },
      log: ({ queue, msg, jobId, errorCode }) =>
        logs.push(`${errorCode === undefined ? 'info' : 'error'}|${queue}|${jobId ?? '-'}|${msg}`),
    },
  };
}

export type HoldStatus = 'HELD' | 'PENDING_PAYMENT' | 'CONFIRMED';

/**
 * Cùng Redis nhưng **lệch DB** — mỗi file test dùng một DB riêng để lượt đối chiếu của file này không đọc
 * hay sửa khoá `hold:*` của file khác đang chạy song song (vitest chạy file song song).
 */
export function redisUrlOffsetBy(base: string, offset: number): string {
  const url = new URL(base);
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  url.pathname = `/${database + offset}`;
  return url.toString();
}

export interface HoldRecordInput {
  readonly bookingId: string;
  readonly channelId: string;
  /** Chuỗi ISO của hạn giữ chỗ ghi trong bản ghi (bản sao của `bookings.hold_expires_at`). */
  readonly expiresAt: string;
  readonly status?: string;
  readonly releasedAt?: string | null;
}

/** Bản ghi `Hold` đúng hình dạng `HoldProjection` của API ghi vào Redis (csdl §3). */
export function holdRecordJson(input: HoldRecordInput): string {
  const record = {
    id: input.bookingId,
    bookingId: input.bookingId,
    channelId: input.channelId,
    expiresAt: input.expiresAt,
    status: input.status ?? 'ACTIVE',
    releasedAt: input.releasedAt ?? null,
    createdAt: '2026-10-18T00:00:00.000Z',
    quotedTotal: 4_000_000,
  };
  return JSON.stringify(record);
}

export interface HoldRecordView {
  readonly status: string | null;
  readonly releasedAt: string | null;
}

/** Trường cần đọc của bản ghi `hold:<bookingId>` (`null` khi khoá không còn). */
export async function readHoldRecord(
  redis: Redis,
  bookingId: string,
  prefix = 'hold:',
): Promise<HoldRecordView | null> {
  const raw = await redis.get(`${prefix}${bookingId}`);
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const status = 'status' in parsed && typeof parsed.status === 'string' ? parsed.status : null;
  const releasedAt =
    'releasedAt' in parsed && typeof parsed.releasedAt === 'string' ? parsed.releasedAt : null;
  return { status, releasedAt };
}

export interface SeedHoldInput {
  /** Nhãn duy nhất trong file: mỗi hold có cơ sở + phòng riêng để nhiều fixture sống chung một CSDL. */
  readonly label: string;
  /** Lệch so với giờ CSDL (giây): âm = đã quá hạn, dương = còn hạn. */
  readonly expiresInSeconds: number;
  readonly status?: HoldStatus;
  /** Số đơn vị bán (booking_rooms + room_assignments) của booking. */
  readonly units?: number;
  readonly channelCode?: 'WEB' | 'OTA_BOOKING';
  /** `channel_allotments.used` mỗi đêm của kỳ ở; `0` ⇒ không dựng hàng allotment. */
  readonly allotmentUsed?: number;
}

export interface HoldFixture {
  readonly bookingId: string;
  readonly bookingCode: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly channelId: string;
  readonly guestId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly roomIds: readonly string[];
  readonly bookingRoomIds: readonly string[];
}

const CHECK_IN_OFFSET_DAYS = 10;
const NIGHTS = 2;

/** Lấy đúng một hàng của câu `INSERT ... RETURNING`; thiếu hàng là lỗi fixture, không phải nhánh nghiệp vụ. */
function onlyRow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`fixture HB-078: không dựng được ${what}`);
  return row;
}

/** Số điện thoại khách: `+84` + 9 chữ số, duy nhất trong file (mỗi file có CSDL riêng — `ck_guests_phone_normalized`). */
let guestSequence = 900_000_000;

export async function seedHold(db: PrismaClient, input: SeedHoldInput): Promise<HoldFixture> {
  const units = input.units ?? 1;
  const channelCode = input.channelCode ?? 'WEB';
  const property = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO properties(code, name, address, phone, latitude, longitude)
      VALUES (${`H078-${input.label}`}, ${`Cơ sở test ${input.label}`}, 'Địa chỉ test', '+84900000000',
              10.776900, 106.700900)
      RETURNING id`,
    'cơ sở test',
  );
  const roomType = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO room_types(property_id, code, name, capacity_adults, base_price, min_price, max_price)
      VALUES (${property.id}::uuid, 'STD', 'Standard test', 2, 2000000, 1500000, 3000000)
      RETURNING id`,
    'loại phòng test',
  );
  const roomIds: string[] = [];
  for (let index = 0; index < units; index += 1) {
    const room = onlyRow(
      await db.$queryRaw<{ id: string }[]>`
        INSERT INTO rooms(property_id, room_type_id, code, name)
        VALUES (${property.id}::uuid, ${roomType.id}::uuid, ${`${input.label}-R${index + 1}`},
                ${`Phòng ${index + 1}`})
        RETURNING id`,
      `phòng ${index + 1}`,
    );
    roomIds.push(room.id);
  }
  // Bảng tham chiếu dùng chung trong một CSDL test: cùng `code` thì lấy hàng đã có (`ON CONFLICT`).
  const channel = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO channels(code, name, multiplier, hold_minutes)
      VALUES (${channelCode}, ${`Kênh ${channelCode}`}, 1.000, 20)
      ON CONFLICT (code) DO UPDATE SET name = excluded.name
      RETURNING id`,
    `kênh ${channelCode}`,
  );
  const policy = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO cancellation_policies(code, name) VALUES ('HB078-POLICY', 'Chính sách test HB-078')
      ON CONFLICT (code) DO UPDATE SET name = excluded.name
      RETURNING id`,
    'chính sách huỷ test',
  );
  const ratePlan = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO rate_plans(code, name, deposit_percent, cancellation_policy_id)
      VALUES ('FLEX7', 'FLEX7 test', 30, ${policy.id}::uuid)
      ON CONFLICT (code) DO UPDATE SET name = excluded.name
      RETURNING id`,
    'gói giá test',
  );
  guestSequence += 1;
  const guest = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO guests(full_name, phone) VALUES (${`Khách ${input.label}`}, ${`+84${guestSequence}`})
      RETURNING id`,
    'khách test',
  );
  const booking = onlyRow(
    await db.$queryRaw<{ id: string; code: string; check_in: Date; check_out: Date }[]>`
      INSERT INTO bookings(code, guest_id, property_id, room_type_id, rate_plan_id, channel_id,
                           check_in, check_out, adults, children, status, room_count, total_amount,
                           deposit_percent, deposit_amount, balance_due, hold_expires_at)
      VALUES (${`PH-260101-${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`},
              ${guest.id}::uuid, ${property.id}::uuid, ${roomType.id}::uuid, ${ratePlan.id}::uuid,
              ${channel.id}::uuid, (CURRENT_DATE + ${CHECK_IN_OFFSET_DAYS}::int),
              (CURRENT_DATE + ${CHECK_IN_OFFSET_DAYS + NIGHTS}::int), 2, 0, ${input.status ?? 'HELD'},
              ${units}, 4000000, 30, 1200000, 4000000,
              clock_timestamp() + make_interval(secs => ${input.expiresInSeconds}))
      RETURNING id, code, check_in, check_out`,
    'booking test',
  );
  const bookingRoomIds: string[] = [];
  for (let index = 0; index < units; index += 1) {
    const bookingRoom = onlyRow(
      await db.$queryRaw<{ id: string }[]>`
        INSERT INTO booking_rooms(booking_id, room_type_id, adults, price_per_night)
        VALUES (${booking.id}::uuid, ${roomType.id}::uuid, 2, 2000000)
        RETURNING id`,
      `đơn vị bán ${index + 1}`,
    );
    bookingRoomIds.push(bookingRoom.id);
    await db.$executeRaw`
      INSERT INTO room_assignments(booking_room_id, room_id, start_date, end_date)
      VALUES (${bookingRoom.id}::uuid, ${roomIds[index]!}::uuid, ${booking.check_in}::date,
              ${booking.check_out}::date)`;
  }
  const allotmentUsed = input.allotmentUsed ?? 0;
  // `channel_allotments` có ràng buộc `allotment ≤ số đơn vị bán của loại phòng` (HB-035/trigger).
  if (allotmentUsed > units)
    throw new Error(
      'fixture HB-078: `allotmentUsed` vượt số đơn vị bán nên hàng allotment sẽ bị CSDL từ chối',
    );
  if (allotmentUsed > 0) {
    await db.$executeRaw`
      INSERT INTO channel_allotments(channel_id, room_type_id, date, allotment, used)
      SELECT ${channel.id}::uuid, ${roomType.id}::uuid, day::date, ${units}::int, ${allotmentUsed}::int
        FROM generate_series(${booking.check_in}::date, ${booking.check_out}::date - 1, '1 day') AS day`;
  }
  return {
    bookingId: booking.id,
    bookingCode: booking.code,
    propertyId: property.id,
    roomTypeId: roomType.id,
    channelId: channel.id,
    guestId: guest.id,
    checkIn: booking.check_in.toISOString().slice(0, 10),
    checkOut: booking.check_out.toISOString().slice(0, 10),
    roomIds,
    bookingRoomIds,
  };
}

export interface HoldStateRow {
  readonly status: string;
  readonly holdExpiresAt: Date | null;
  readonly activeAssignments: number;
  readonly releasedAssignments: number;
  readonly releaseReasons: string[];
  readonly history: { from: string | null; to: string; reason: string | null }[];
  readonly audit: { action: string; actorRole: string; actorId: string | null; after: unknown }[];
  readonly outbox: { eventType: string; operation: string | null; roomIds: string[] }[];
  readonly allotmentUsed: number[];
}

/** Trạng thái đầy đủ của một booking sau lượt quét — mọi thứ phải đổi **cùng transaction** (BR-BOOK-08). */
export async function holdState(db: PrismaClient, fixture: HoldFixture): Promise<HoldStateRow> {
  const bookings = await db.$queryRaw<{ status: string; hold_expires_at: Date | null }[]>`
    SELECT status, hold_expires_at FROM bookings WHERE id = ${fixture.bookingId}::uuid`;
  const booking = bookings[0];
  if (booking === undefined) throw new Error('không thấy booking test');
  const assignments = await db.$queryRaw<{ active: bigint; released: bigint }[]>`
    SELECT count(*) FILTER (WHERE a.released_at IS NULL) AS active,
           count(*) FILTER (WHERE a.released_at IS NOT NULL) AS released
      FROM room_assignments a
      JOIN booking_rooms br ON br.id = a.booking_room_id
     WHERE br.booking_id = ${fixture.bookingId}::uuid`;
  const reasons = await db.$queryRaw<{ release_reason: string | null }[]>`
    SELECT a.release_reason FROM room_assignments a
      JOIN booking_rooms br ON br.id = a.booking_room_id
     WHERE br.booking_id = ${fixture.bookingId}::uuid AND a.released_at IS NOT NULL`;
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
  const allotments = await db.$queryRaw<{ used: number }[]>`
    SELECT used FROM channel_allotments
     WHERE channel_id = ${fixture.channelId}::uuid AND room_type_id = ${fixture.roomTypeId}::uuid
     ORDER BY date`;
  return {
    status: booking.status,
    holdExpiresAt: booking.hold_expires_at,
    activeAssignments: Number(assignments[0]?.active ?? 0),
    releasedAssignments: Number(assignments[0]?.released ?? 0),
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
    allotmentUsed: allotments.map((row) => row.used),
  };
}
