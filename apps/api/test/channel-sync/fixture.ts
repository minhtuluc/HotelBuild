/**
 * Fixture dùng chung cho test khoá HB-131 (giai đoạn A).
 *
 * Mỗi tệp test dựng **một** CSDL PostgreSQL 16 riêng (migration thật của repo) và một app Nest thật,
 * nên test đi qua HTTP/CSDL thật. Redis dùng DB 12 để không đụng suite khác.
 *
 * Ghi chú hợp đồng giai đoạn A (B phải hiện thực đúng các điểm này):
 * - `POST /channels/{channelId}/sync` trả `202 {operationId,status,statusUrl}` + `Location`; `statusUrl`
 *   dùng lại `/api/v1/operations/{operationId}` (api.md §6.4) và chỉ người khởi tạo/OWNER đọc được.
 * - `PUT /channels/{channelId}/mappings` nhận `If-Match` theo `version` hiện hành của kênh
 *   (`GET /channels/{channelId}`), thiếu ⇒ 428 `E_GEN_PRECONDITION_REQUIRED`, lệch ⇒ 412
 *   `E_GEN_VERSION_CONFLICT`; body đúng các trường `roomTypeId`, `providerRoomTypeCode`, `allotmentPct`.
 * - `POST /channels/{channelId}/sales-closure` trả 200 `{channelId, rows:[{roomTypeId, date, closed,
 *   manual:{closed,reason,closedAt,reopenedAt}, automatic:{...}}]}`; `closed` mặc định true.
 * - `GET /channels/{channelId}/sync-status`, `GET /channels/{channelId}/outbox-deliveries`,
 *   `POST /channels/{channelId}/outbox-deliveries/{deliveryId}/retry` theo HB-120.
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import request from 'supertest';
import { tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const PASSWORD = 'Synthetic-HB131-only!';

export const USERS = {
  owner: 'hb131-owner',
  manager: 'hb131-manager',
  manager2: 'hb131-manager2',
  frontDesk: 'hb131-front-desk',
  accountant: 'hb131-accountant',
  housekeeping: 'hb131-housekeeping',
} as const;

export interface ChannelSeed {
  propertyId: string;
  otherPropertyId: string;
  typeId: string;
  dormTypeId: string;
  otherTypeId: string;
  ratePlanId: string;
  guestId: string;
  /** Mã kênh → UUID. */
  channels: Record<string, string>;
  /** Tên đăng nhập → UUID người dùng. */
  userIds: Record<string, string>;
}

export const seed: ChannelSeed = {
  propertyId: '',
  otherPropertyId: '',
  typeId: '',
  dormTypeId: '',
  otherTypeId: '',
  ratePlanId: '',
  guestId: '',
  channels: {},
  userIds: {},
};

let app: NestFastifyApplication;
let owner: pg.Client;
let admin: pg.Client;
const name = `hb131_${randomUUID().replaceAll('-', '')}`;
const role = `hb131_${randomUUID().replaceAll('-', '')}`;

/** Kết nối **chủ sở hữu** CSDL — chỉ fixture/assert dùng; app chạy bằng vai trò `app_rw`. */
export async function rows<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await owner.query<T>(sql, values)).rows;
}

export async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

export const http = () => request(app.getHttpServer());

export async function login(username: string): Promise<string> {
  const response = await http().post('/api/v1/auth/login').send({ username, password: PASSWORD });
  if (response.status !== 200) throw new Error(`đăng nhập ${username} lỗi ${response.status}`);
  return tokenPairSchema.parse(response.body).accessToken;
}

export function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Kết nối chủ CSDL riêng cho test cần giữ transaction để dựng barrier khoá. */
export async function ownerClient(): Promise<pg.Client> {
  const url = process.env['DATABASE_MIGRATION_URL'];
  if (!url) throw new Error('HB-131 cần PostgreSQL 16; thiếu DATABASE_MIGRATION_URL');
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: parsed.href });
  await client.connect();
  return client;
}

export async function setup(): Promise<void> {
  const migrationUrl = process.env['DATABASE_MIGRATION_URL'];
  if (!migrationUrl) throw new Error('HB-131 cần PostgreSQL 16; thiếu DATABASE_MIGRATION_URL');
  admin = new pg.Client({ connectionString: migrationUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const ownerUrl = new URL(migrationUrl);
  ownerUrl.pathname = `/${name}`;
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
  await admin.query(`CREATE ROLE "${role}" LOGIN INHERIT PASSWORD ${quoted}`);
  await admin.query(`GRANT app_rw TO "${role}"`);
  const runtime = new URL(ownerUrl);
  runtime.username = role;
  runtime.password = pass;

  seed.propertyId = await insert(
    "INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES('CS-01','Cơ sở 1','Synthetic','+84900000131',10.7769,106.7009) RETURNING id",
  );
  seed.otherPropertyId = await insert(
    "INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES('CS-02','Cơ sở 2','Synthetic','+84900000132',10.7769,106.7009) RETURNING id",
  );
  seed.typeId = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Standard',2,500000,400000,900000) RETURNING id",
    [seed.propertyId],
  );
  seed.dormTypeId = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price,allow_shared) VALUES($1,'DOR','Dorm',1,150000,120000,250000,true) RETURNING id",
    [seed.propertyId],
  );
  seed.otherTypeId = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'SUP','Superior',2,700000,600000,1200000) RETURNING id",
    [seed.otherPropertyId],
  );
  for (const code of ['R1', 'R2', 'R3', 'R4', 'R5']) {
    await insert(
      'INSERT INTO rooms(property_id,room_type_id,code,name) VALUES($1,$2,$3,$3) RETURNING id',
      [seed.propertyId, seed.typeId, code],
    );
  }
  await insert(
    "INSERT INTO rooms(property_id,room_type_id,code,name,bed_count) VALUES($1,$2,'D1','D1',6) RETURNING id",
    [seed.propertyId, seed.dormTypeId],
  );
  await insert(
    'INSERT INTO rooms(property_id,room_type_id,code,name) VALUES($1,$2,$3,$3) RETURNING id',
    [seed.otherPropertyId, seed.otherTypeId, 'X1'],
  );
  for (const code of [
    'WEB',
    'PHONE',
    'WALKIN',
    'OTA_BOOKING',
    'OTA_AGODA',
    'OTA_AIRBNB',
    'AGENCY',
  ]) {
    seed.channels[code] = await insert(
      'INSERT INTO channels(code,name,multiplier) VALUES($1,$1,1) RETURNING id',
      [code],
    );
  }
  const policyId = await insert(
    "INSERT INTO cancellation_policies(code,name) VALUES('HB131','Synthetic') RETURNING id",
  );
  seed.ratePlanId = await insert(
    "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('FLEX7','Synthetic',30,$1) RETURNING id",
    [policyId],
  );
  seed.guestId = await insert(
    "INSERT INTO guests(full_name,phone) VALUES('Khách Synthetic','+84900000133') RETURNING id",
  );

  const encoded = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const roles: readonly [string, string, string | null][] = [
    [USERS.owner, 'OWNER', null],
    [USERS.manager, 'MANAGER', seed.propertyId],
    [USERS.manager2, 'MANAGER', seed.otherPropertyId],
    [USERS.frontDesk, 'FRONT_DESK', seed.propertyId],
    [USERS.accountant, 'ACCOUNTANT', seed.propertyId],
    [USERS.housekeeping, 'HOUSEKEEPING', seed.propertyId],
  ];
  for (const [username, userRole, property] of roles) {
    const id = await insert(
      "INSERT INTO users(username,password_hash,full_name,role) VALUES($1,$2,'Synthetic',$3) RETURNING id",
      [username, encoded, userRole],
    );
    seed.userIds[username] = id;
    if (property !== null)
      await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1,$2)', [
        id,
        property,
      ]);
  }
  for (const [key, value] of [
    ['job.channelSync.intervalSeconds', '300'],
    ['channel.lowInventoryThreshold', '2'],
  ] as const)
    await rows(
      "INSERT INTO system_settings(key,value,value_type) VALUES($1,$2,'NUMBER') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
      [key, value],
    );

  const redisUrl = new URL(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379');
  redisUrl.pathname = '/12';
  // DB 12 dùng chung với suite khác; hạn mức login 10/phút/IP đếm **mọi** lần đăng nhập. Không xoá
  // đầu suite thì bộ test này có thể thừa hưởng counter và nhận 429/500 dù sản phẩm đúng.
  const redis = new Redis(redisUrl.href);
  await redis.flushdb();
  await redis.quit();
  const registered = AppModule.register({
    DATABASE_URL: runtime.href,
    REDIS_URL: redisUrl.href,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    PORT: 0,
  });
  app = await NestFactory.create<NestFastifyApplication>({ ...registered }, new FastifyAdapter(), {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
}

export async function teardown(): Promise<void> {
  await app?.close();
  await owner?.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin?.end();
}

/** Mốc ngày xa hiện tại để test không phụ thuộc ngày chạy. */
export const FROM = '2027-03-01';
export const TO = '2027-03-04';

/** Booking OTA tổng hợp (không cần giao phòng) để kiểm projection/hàng đợi. */
export async function booking(options: {
  code: string;
  property?: string;
  channel?: string;
  status?: string;
  checkIn?: string;
  checkOut?: string;
  externalRef?: string;
  duplicate?: boolean;
}): Promise<string> {
  const id = await insert(
    `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent,status,total_amount,deposit_amount,external_ref,duplicate_suspected)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,30,$9,500000,150000,$10,$11) RETURNING id`,
    [
      options.code,
      seed.guestId,
      options.property ?? seed.propertyId,
      seed.typeId,
      seed.ratePlanId,
      seed.channels[options.channel ?? 'OTA_BOOKING'],
      options.checkIn ?? FROM,
      options.checkOut ?? '2027-03-02',
      options.status ?? 'CONFIRMED',
      options.externalRef ?? `EXT-${options.code}`,
      options.duplicate ?? false,
    ],
  );
  await insert(
    'INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night) VALUES($1,$2,1,500000) RETURNING id',
    [id, seed.typeId],
  );
  return id;
}

/** Ảnh chụp tác dụng phụ để chứng minh rollback/replay không đổi dữ liệu. */
export async function effects() {
  return {
    audit: Number((await rows('SELECT count(*) AS n FROM audit_logs'))[0]!.n),
    outbox: Number((await rows('SELECT count(*) AS n FROM outbox_events'))[0]!.n),
    mappings: await rows(
      'SELECT room_type_id, external_room_code FROM channel_mappings ORDER BY room_type_id',
    ),
    completed: Number(
      (await rows("SELECT count(*) AS n FROM idempotency_keys WHERE status='COMPLETED'"))[0]!.n,
    ),
    usage: await rows('SELECT used FROM channel_allotments ORDER BY id'),
  };
}

/** Hàng đợi OTA tổng hợp cho test phân trang + projection (gồm payload inbox chứa PII/bí mật). */
export async function otaQueueFixtures(): Promise<{
  confirmed: string;
  duplicate: string;
  foreign: string;
}> {
  const confirmed = await booking({
    code: 'PH-261101-QUE01',
    externalRef: 'OTA-QUEUE-1',
    checkIn: '2027-04-01',
    checkOut: '2027-04-02',
  });
  const duplicate = await booking({
    code: 'PH-261101-QUE02',
    externalRef: 'OTA-QUEUE-2',
    checkIn: '2027-04-02',
    checkOut: '2027-04-03',
    duplicate: true,
  });
  const foreign = await booking({
    code: 'PH-261101-QUE03',
    externalRef: 'OTA-QUEUE-3',
    property: seed.otherPropertyId,
    checkIn: '2027-04-03',
    checkOut: '2027-04-04',
  });
  await rows(
    `INSERT INTO webhook_inbox(provider,provider_account_id,event_id,payload_hash,payload_json,signature_verified_at)
     VALUES('booking','acct-hb131','evt-hb131','hash',$1,now())`,
    [
      JSON.stringify({
        guestPhone: '+84900000001',
        guestEmail: 'secret@example.com',
        signature: 'SUPER-SECRET-SIGNATURE',
        token: 'SUPER-SECRET-TOKEN',
      }),
    ],
  );
  return { confirmed, duplicate, foreign };
}

/** Trạng thái monitoring: kênh DEGRADED + một delivery DEAD_LETTER và một delivery COMPLETED. */
export async function monitoringFixtures(): Promise<{ deadEvent: string; doneEvent: string }> {
  await rows(
    "UPDATE channels SET sync_status='DEGRADED', consecutive_sync_failures=3, last_sync_error='E_CHAN_SYNC_FAILED', last_sync_at=now() WHERE code='OTA_BOOKING'",
  );
  const deadEvent = await insert(
    "INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,channel_id,payload_json) SELECT 'channel.inventory.changed','Channel',id,id,'{}'::jsonb FROM channels WHERE code='OTA_BOOKING' RETURNING id",
  );
  const doneEvent = await insert(
    "INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,channel_id,payload_json) SELECT 'channel.price.changed','Channel',id,id,'{}'::jsonb FROM channels WHERE code='OTA_BOOKING' RETURNING id",
  );
  await rows(
    "INSERT INTO event_deliveries(event_id,consumer,status,attempts,last_error) VALUES($1,'channel-sync','DEAD_LETTER',5,'E_CHAN_SYNC_FAILED')",
    [deadEvent],
  );
  await rows(
    "INSERT INTO event_deliveries(event_id,consumer,status,attempts,completed_at) VALUES($1,'channel-sync','COMPLETED',1,now())",
    [doneEvent],
  );
  await rows(
    "INSERT INTO event_deliveries(event_id,consumer,status,attempts) VALUES($1,'notification-send','PENDING',0)",
    [deadEvent],
  );
  return { deadEvent, doneEvent };
}
