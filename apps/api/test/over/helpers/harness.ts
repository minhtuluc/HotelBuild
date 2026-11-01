/**
 * Harness HB-124 — app thật (`AppModule.register`), PostgreSQL 16 tách riêng từng tệp spec
 * (`test/idempotency/database.ts`), Redis7 thuê riêng một DB con theo `REDIS_URL` cấp cho suite.
 *
 * GIAI ĐOẠN A: các tuyến OVER chưa tồn tại; mỗi ca dừng ở `guardRoute` với lý do "chưa hiện thực".
 * Vì vậy seed phải đọc lại hàng vừa ghi trước khi gọi HTTP — lỗi fixture không được giả làm thiếu
 * endpoint. Không dùng `FLUSHDB` ngoài DB đã thuê bằng khoá NX.
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { errorBodySchema, pinTokenSchema, tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../../src/app.module.js';
import { CLOCK } from '../../../src/infrastructure/ports.js';
import {
  clock,
  databaseUrl,
  password,
  propertyId,
  otherPropertyId,
  rows,
} from '../../idempotency/database.js';

export { clock, databaseUrl, password, propertyId, otherPropertyId, rows };

/** Ngày nghiệp vụ của đồng hồ giả và ngày nhận phòng mặc định của seed. */
export const D = '2026-11-10';
export const CHECK_IN = '2026-11-18';
export const NIGHTLY = 500_000;
export const PIN = '123456';
const DAY = 86_400_000;

/** Nhân viên tổng hợp: mỗi người một `users.id` để maker–checker/self-approval có nghĩa. */
export const STAFF = {
  desk: { username: 'h029-first', role: 'FRONT_DESK' },
  manager: { username: 'h029-second', role: 'MANAGER' },
  accountant: { username: 'h124-accountant', role: 'ACCOUNTANT' },
  owner: { username: 'h124-owner', role: 'OWNER' },
  scoped: { username: 'h124-scoped', role: 'FRONT_DESK' },
  sysadmin: { username: 'h124-sysadmin', role: 'SYSADMIN' },
} as const;
export const STAFF_KEYS = ['desk', 'manager', 'accountant', 'owner', 'scoped', 'sysadmin'] as const;
export type StaffKey = (typeof STAFF_KEYS)[number];

let app: NestFastifyApplication;
let redis: Redis;
let redisUrl = '';
let redisLeaseId = '';
let releaseLease: (() => Promise<void>) | undefined;

export const rooms = {
  r1: '',
  r2: '',
  r3: '',
  d1: '',
  d2: '',
  c1: '',
  c2: '',
  o1: '',
  x1: '',
};
export const guests = { male: '', female: '', unspecified: '' };
export const roomTypes = { std: '', dorm: '', connecting: '', oversold: '', other: '' };
export const ratePlanId = { value: '' };
export const channelId = { value: '' };
export const userIds = {
  desk: '',
  manager: '',
  accountant: '',
  owner: '',
  scoped: '',
  sysadmin: '',
};

export const http = () => request(app.getHttpServer());
export const day = (date: string, offset: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
export const vn = (date: string, time: string) => Date.parse(`${date}T${time}+07:00`);

export async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

async function leaseRedis(): Promise<Redis> {
  const source = process.env.REDIS_URL;
  if (source === undefined) throw new Error('HB-124 requires real Redis7; no skip fallback');
  const base = new URL(source);
  const first = Number(base.pathname.replace('/', '') || '0');
  redisLeaseId = randomUUID();
  for (let index = first; index < first + 16; index += 1) {
    const candidate = new URL(base.href);
    candidate.pathname = `/${index}`;
    const client = new Redis(candidate.href, { lazyConnect: true });
    await client.connect();
    const acquired = await client.set('hb124:fixture:lease', redisLeaseId, 'EX', 1800, 'NX');
    if (acquired === 'OK') {
      await client.flushdb();
      redisUrl = candidate.href;
      return client;
    }
    await client.quit();
  }
  throw new Error('HB-124: no free Redis logical DB to lease — dùng một service Redis riêng');
}

export async function flushRedis(): Promise<void> {
  await redis.flushdb();
}

export async function staffToken(key: StaffKey): Promise<string> {
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: STAFF[key].username, password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

/** `pinToken` dùng một lần gắn đúng actor + booking (BR-RBAC-05). */
export async function mintPin(key: StaffKey, bookingId: string): Promise<string> {
  const token = await staffToken(key);
  const response = await http()
    .post('/api/v1/auth/pin/verify')
    .set('Authorization', `Bearer ${token}`)
    .send({ pin: PIN, bookingId });
  expect(response.status).toBe(200);
  return pinTokenSchema.parse(response.body).pinToken;
}

export interface CallOptions {
  readonly key?: string | null;
  readonly tag?: string | null;
}

export function post(
  path: string,
  token: string,
  body: object = {},
  options: CallOptions = {},
): request.Test {
  const call = http().post(path).set('Authorization', `Bearer ${token}`);
  if (options.key !== null) call.set('Idempotency-Key', options.key ?? randomUUID());
  if (options.tag !== null && options.tag !== undefined) call.set('If-Match', options.tag);
  return call.send(body);
}

export const get = (path: string, token: string) =>
  http().get(path).set('Authorization', `Bearer ${token}`);

export const errorCode = (response: { body: unknown }) => errorBodySchema.parse(response.body).code;

/** Chốt "đỏ vì thiếu hành vi" trước mọi assertion nghiệp vụ (F6-D05). */
export function guardRoute(response: { status: number; body: unknown }, methodPath: string): void {
  if (response.status !== 404 && response.status !== 405) return;
  const parsed = errorBodySchema.safeParse(response.body);
  const code = parsed.success ? parsed.data.code : 'E_GEN_NOT_FOUND';
  throw new Error(
    `GIAI ĐOẠN A ĐỎ CÓ CHỦ ĐÍCH: ${methodPath} chưa được hiện thực (${response.status} ${code}).`,
  );
}

export function etagOf(response: { headers: Record<string, unknown> }): string {
  const tag = response.headers.etag;
  if (typeof tag !== 'string' || tag.length === 0)
    throw new Error('Route đọc OVER thiếu ETag/version (§1.3)');
  return tag;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await rows(
    `INSERT INTO system_settings(key,value,value_type) VALUES($1,$2,'NUMBER')
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, version=system_settings.version+1`,
    [key, value],
  );
}

/** Ép mọi INSERT vào một bảng lỗi để kiểm rollback đa bảng (fault injection đúng biên port). */
export async function withFailingInsert<T>(
  table: string,
  trigger: string,
  run: () => Promise<T>,
): Promise<T> {
  await rows(
    `CREATE OR REPLACE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN RAISE EXCEPTION 'Synthetic HB-124 rejection on ${table}'; END $$`,
  );
  await rows(`CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
  try {
    return await run();
  } finally {
    await rows(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
    await rows(`DROP FUNCTION IF EXISTS ${trigger}()`);
  }
}

/** Bản ghi tìm kiếm hành động OVER trong audit (không bao giờ đọc PIN thô). */
export const auditRows = (entityId: string) =>
  rows('SELECT action,actor_id,after_json::text AS after FROM audit_logs WHERE entity_id=$1', [
    entityId,
  ]);

export const outboxFor = (aggregateId: string) =>
  rows('SELECT event_type FROM outbox_events WHERE aggregate_id=$1', [aggregateId]);

export const completedKeys = (pathLike: string) =>
  rows("SELECT id FROM idempotency_keys WHERE status='COMPLETED' AND path LIKE $1", [pathLike]);

async function insertedUsers(): Promise<void> {
  const extra = [STAFF.accountant, STAFF.owner, STAFF.scoped, STAFF.sysadmin];
  for (const user of extra) {
    const id = await insert(
      `INSERT INTO users(username,password_hash,full_name,role)
       SELECT $1,password_hash,'Synthetic HB-124',$2 FROM users WHERE username='h029-first'
       RETURNING id`,
      [user.username, user.role],
    );
    await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid)', [
      id,
      propertyId,
    ]);
    if (user.username === STAFF.accountant.username) userIds.accountant = id;
    if (user.username === STAFF.owner.username) userIds.owner = id;
    if (user.username === STAFF.scoped.username) userIds.scoped = id;
    if (user.username === STAFF.sysadmin.username) userIds.sysadmin = id;
  }
  for (const [key, username] of [
    ['desk', STAFF.desk.username],
    ['manager', STAFF.manager.username],
  ] as const)
    userIds[key] = String(
      (await rows('SELECT id FROM users WHERE username=$1', [username]))[0]!.id,
    );
}

async function insertedInventory(): Promise<void> {
  const policy = await insert(
    "INSERT INTO cancellation_policies(code,name) VALUES('HB124','Synthetic HB-124') RETURNING id",
  );
  await rows(
    `INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order)
     VALUES($1,168,100,false,'>=7d',1),($1,72,50,false,'3-7d',2),
           ($1,24,0,false,'1-3d',3),($1,-1,0,true,'<24h',4)`,
    [policy],
  );
  ratePlanId.value = await insert(
    `INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id)
     VALUES('FLEX7','Synthetic FLEX7',30,$1) RETURNING id`,
    [policy],
  );
  const channel = await insert(
    "INSERT INTO channels(code,name,multiplier) VALUES('WEB','Web',1) RETURNING id",
  );
  channelId.value = channel;
  roomTypes.std = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price)
     VALUES($1,'STD','Synthetic STD',2,500000,400000,3000000) RETURNING id`,
    [propertyId],
  );
  roomTypes.dorm = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price,allow_shared)
     VALUES($1,'DOR','Synthetic DOR',6,250000,100000,2000000,true) RETURNING id`,
    [propertyId],
  );
  roomTypes.connecting = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price)
     VALUES($1,'SUP','Synthetic SUP',2,850000,600000,3000000) RETURNING id`,
    [propertyId],
  );
  roomTypes.oversold = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price)
     VALUES($1,'FAM','Synthetic FAM',1,500000,400000,3000000) RETURNING id`,
    [propertyId],
  );
  roomTypes.other = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price)
     VALUES($1,'STD','Synthetic STD other',2,500000,400000,3000000) RETURNING id`,
    [otherPropertyId],
  );
  const room = (property: string, type: string, code: string, beds = 1) =>
    insert(
      `INSERT INTO rooms(property_id,room_type_id,code,name,bed_count) VALUES($1,$2,$3,$3,$4) RETURNING id`,
      [property, type, code, beds],
    );
  rooms.r1 = await room(propertyId, roomTypes.std, 'R1');
  rooms.r2 = await room(propertyId, roomTypes.std, 'R2');
  rooms.r3 = await room(propertyId, roomTypes.std, 'R3');
  rooms.d1 = await room(propertyId, roomTypes.dorm, 'D1', 6);
  rooms.d2 = await room(propertyId, roomTypes.dorm, 'D2', 6);
  rooms.c1 = await room(propertyId, roomTypes.connecting, 'C1');
  rooms.c2 = await room(propertyId, roomTypes.connecting, 'C2');
  rooms.o1 = await room(propertyId, roomTypes.oversold, 'O1');
  rooms.x1 = await room(otherPropertyId, roomTypes.other, 'X1');
  await rows(
    'UPDATE rooms SET connecting_room_id=CASE WHEN id=$1::uuid THEN $2::uuid ELSE $1::uuid END WHERE id=ANY($3::uuid[])',
    [rooms.c1, rooms.c2, [rooms.c1, rooms.c2]],
  );
  const guest = (name: string, phone: string, gender: string) =>
    insert('INSERT INTO guests(full_name,phone,gender) VALUES($1,$2,$3) RETURNING id', [
      name,
      phone,
      gender,
    ]);
  guests.male = await guest('HB124 Male', '+84900001241', 'MALE');
  guests.female = await guest('HB124 Female', '+84900001242', 'FEMALE');
  guests.unspecified = await guest('HB124 Unknown', '+84900001243', 'UNSPECIFIED');
}

async function bootApp(url: string): Promise<void> {
  const registered = AppModule.register({
    DATABASE_URL: databaseUrl,
    REDIS_URL: url,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    PORT: 0,
  });
  app = await NestFactory.create<NestFastifyApplication>(
    {
      ...registered,
      providers: [
        ...(registered.providers ?? []).filter(
          (provider) =>
            typeof provider !== 'object' ||
            provider === null ||
            !('provide' in provider) ||
            provider.provide !== CLOCK,
        ),
        { provide: CLOCK, useValue: clock },
      ],
    },
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
}

beforeAll(async () => {
  const owner = process.env.DATABASE_MIGRATION_URL;
  if (owner === undefined)
    throw new Error('HB-124 requires dedicated PostgreSQL16 owner; no skip fallback');
  redis = await leaseRedis();
  await insertedUsers();
  await insertedInventory();
  await bootApp(redisUrl);
  for (const key of STAFF_KEYS) {
    const token = await staffToken(key);
    const set = await http()
      .put('/api/v1/auth/pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: PIN, currentPassword: password });
    expect(set.status).toBe(204);
  }
  releaseLease = async () => {
    await redis.eval(
      "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
      1,
      'hb124:fixture:lease',
      redisLeaseId,
    );
  };
}, 120000);

beforeEach(async () => {
  clock.value = vn(D, '10:00:00');
  await flushRedis();
  for (const key of STAFF_KEYS)
    await rows('UPDATE users SET role=$1,is_active=true WHERE username=$2', [
      STAFF[key].role,
      STAFF[key].username,
    ]);
  await rows('DELETE FROM user_property_scopes WHERE user_id=ANY($1::uuid[])', [
    STAFF_KEYS.map((key) => userIds[key]),
  ]);
  await rows(
    `INSERT INTO user_property_scopes(user_id,property_id)
     SELECT u.id,$2::uuid FROM users u WHERE u.username=ANY($1::text[])`,
    [STAFF_KEYS.map((key) => STAFF[key].username), propertyId],
  );
  await rows('DELETE FROM room_blocks');
  await rows('TRUNCATE bookings CASCADE');
  await rows('DELETE FROM overbooking_cases');
  await rows('DELETE FROM outbox_events');
  await rows('DELETE FROM notifications');
  await rows('DELETE FROM idempotency_keys');
  await rows('DELETE FROM refund_payout_simulator_transfers');
  await rows(
    "DELETE FROM system_settings WHERE key IN ('refund.feeAmount','deal.threshold.minor')",
  );
  await rows("UPDATE rooms SET status='ACTIVE'");
});

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await releaseLease?.();
    await redis?.quit();
  }
}, 30000);
