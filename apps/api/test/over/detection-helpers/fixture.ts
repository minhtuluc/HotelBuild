/**
 * Fixture HB-126 — app thật (`AppModule.register`) trên CSDL tạm riêng + PostgreSQL16 + Redis7 DB `/10`,
 * clock giả điều khiển mốc nghiệp vụ. Bộ test khoá nằm ở `detection.locked.spec.ts` và
 * `detection-queries.locked.spec.ts`.
 *
 * Tái dùng seed chung HB-029 (`test/idempotency/database.ts`: cơ sở `H029-A`/`H029-B`, hai nhân viên,
 * role runtime `app_rw`) và HB-034 (`test/room-blocks/inventory-seed.ts`: `STD` hai phòng `R1`/`R2`,
 * `DOR` một phòng 6 giường, `otherTypeId` ở cơ sở B, helper `booking`/`assign`/`block`). Fixture này thêm:
 * - cơ sở thứ ba `H126-C` và loại `DLX` hạng cao hơn ở `H029-A` (thang 4 bậc: bậc 3 không khả dụng vì
 *   toạ độ ba cơ sở cách nhau ≫ 15 km; bậc 2 còn phòng trống để `UPGRADE_SAME_PROPERTY` khả thi);
 * - phiên khách thật cho từng booking (mỗi lần đặt cần khách riêng, nếu không HB-077 trả booking cũ),
 *   phiên nhân viên qua `POST /auth/login`, scope theo cơ sở;
 * - `POST /quotes` + `POST /bookings` đúng hợp đồng F4 để kiểm TC-OVER-03/04 ngay trong transaction.
 *
 * Mỗi lần seed đều đọc lại hàng vừa ghi: lỗi fixture/typo không bao giờ được giả làm "thiếu hành vi".
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { z } from 'zod';
import {
  bookingSummarySchema,
  quoteSchema,
  tokenPairSchema,
  type AccessTokenClaims,
} from '@pinehill/contracts';
import { AppModule } from '../../../src/app.module.js';
import { signAccessToken } from '../../../src/infrastructure/crypto/access-tokens.js';
import { CLOCK } from '../../../src/infrastructure/ports.js';
import {
  clock,
  databaseUrl,
  otherPropertyId,
  password,
  propertyId,
  rows,
  secondUserId,
  userId,
} from '../../idempotency/database.js';
import { typeId } from '../../room-blocks/inventory-seed.js';

export {
  clock,
  db,
  otherPropertyId,
  propertyId,
  rows,
  secondUserId,
  userId,
} from '../../idempotency/database.js';
export {
  assign,
  block,
  booking,
  dormId,
  dormTypeId,
  roomId,
  room2Id,
  stay,
  typeId,
  otherTypeId,
  otherRoomId,
} from '../../room-blocks/inventory-seed.js';
import { openGuestSession } from '../../support/guest-session.js';

export const DAY = 86_400_000;
/** Ngày nghiệp vụ ghim cho cả bộ test; giờ VN không có DST nên cộng/trừ ngày bằng UTC là đúng. */
export const D = '2026-12-10';
/** Mốc "hôm nay" của bộ test — trước `D` bảy ngày để mọi ranh giới T−24h còn ở tương lai. */
export const TODAY = '2026-12-03';

export const day = (date: string, offset: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
export const vn = (date: string, time: string) => Date.parse(`${date}T${time}+07:00`);

let app: NestFastifyApplication;
let redis: Redis;
const secrets = {
  access: randomBytes(32).toString('hex'),
  refresh: randomBytes(32).toString('hex'),
};

export const http = () => request(app.getHttpServer());

export let thirdPropertyId = '';
export let thirdTypeId = '';
export let thirdRoomId = '';
export let upgradeTypeId = '';
export let upgradeRoomId = '';

/** Vai trò phiên khách do HB-017 phát hành (không nằm trong `userRoleSchema` của nhân viên). */
const GUEST_ROLE = z.custom<AccessTokenClaims['role']>((value) => value === 'GUEST').parse('GUEST');

async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

/** Token phiên khách cho một `guests.id` đã có (HB-017 chưa mở nên phát hành đúng loại token ấy). */
export async function guestTokenFor(id: string): Promise<string> {
  const sessionId = await openGuestSession(rows, id);
  const { token } = await signAccessToken(
    { userId: id, role: GUEST_ROLE, propertyScope: [], sessionId },
    secrets.access,
    clock.now(),
  );
  return token;
}

export interface GuestSession {
  readonly id: string;
  readonly token: string;
  readonly phone: string;
}

/** SĐT đã chuẩn hoá `+84[0-9]{9}` (DDL `ck_guests_phone_normalized`), đủ ngẫu nhiên giữa các ca. */
function syntheticPhone(): string {
  return `+849${randomUUID()
    .replaceAll('-', '')
    .replace(/[^0-9]/gu, '')
    .padEnd(8, '7')
    .slice(0, 8)}`;
}

/** Mỗi booking thử nghiệm cần khách riêng: HB-077 gộp trùng theo cùng khách/SĐT trong 24 giờ. */
export async function guestSession(fullName = 'HB-126 Guest'): Promise<GuestSession> {
  const phone = syntheticPhone();
  const id = await insert('INSERT INTO guests(full_name,phone) VALUES($1,$2) RETURNING id', [
    fullName,
    phone,
  ]);
  return { id, token: await guestTokenFor(id), phone };
}

/** Phiên nhân viên thật qua `POST /auth/login`; đổi vai trò người dùng trước khi đăng nhập. */
export async function tokenFor(role: string, username = 'h029-first'): Promise<string> {
  await rows('UPDATE users SET role=$1,is_active=true WHERE username=$2', [role, username]);
  const response = await http().post('/api/v1/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

/** Thay scope cơ sở của một nhân viên (BR-RBAC-02). */
export async function setScope(username: string, properties: readonly string[]): Promise<void> {
  await rows(
    'DELETE FROM user_property_scopes WHERE user_id=(SELECT id FROM users WHERE username=$1)',
    [username],
  );
  for (const property of properties)
    await rows(
      'INSERT INTO user_property_scopes(user_id,property_id) VALUES((SELECT id FROM users WHERE username=$1),$2)',
      [username, property],
    );
}

export async function setOverbookPct(pct: number | string, property = propertyId): Promise<void> {
  await rows('UPDATE properties SET overbook_limit_pct=$1 WHERE id=$2', [String(pct), property]);
}

export async function setOverbookAllowed(code: string, allowed: boolean): Promise<void> {
  await rows('UPDATE channels SET overbook_allowed=$1 WHERE code=$2', [allowed, code]);
}

/** `POST /quotes` (HB-074) bằng chính phiên khách sẽ đặt phòng. */
export async function issueQuote(token: string, input: Record<string, unknown> = {}) {
  const response = await http()
    .post('/api/v1/quotes')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      propertyId,
      roomTypeId: typeId,
      channelCode: 'WEB',
      ratePlanCode: 'FLEX7',
      checkIn: D,
      checkOut: day(D, 1),
      adults: 2,
      children: 0,
      roomCount: 1,
      ...input,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return quoteSchema.parse(response.body);
}

export interface BookingAttempt {
  readonly status: number;
  /** Chưa parse: test tự chọn schema (`bookingSummarySchema` hay `errorBodySchema`). */
  readonly body: unknown;
}

/** Một lệnh `POST /bookings` thật; không assert status để test tự đánh giá đỏ/xanh. */
export async function attemptBooking(
  guest: GuestSession,
  overrides: Record<string, unknown> = {},
): Promise<BookingAttempt> {
  const checkIn = typeof overrides.checkIn === 'string' ? overrides.checkIn : D;
  const checkOut = typeof overrides.checkOut === 'string' ? overrides.checkOut : day(checkIn, 1);
  const quote = await issueQuote(guest.token, { checkIn, checkOut, ...overrides });
  const response = await http()
    .post('/api/v1/bookings')
    .set('Authorization', `Bearer ${guest.token}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      propertyId,
      roomTypeId: typeId,
      ratePlanCode: 'FLEX7',
      channelCode: 'WEB',
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      roomCount: 1,
      guest: { fullName: 'HB-126 Guest', phone: guest.phone },
      ...overrides,
      quoteId: quote.quoteId,
    });
  return { status: response.status, body: response.body };
}

export const createdBooking = (attempt: BookingAttempt) => {
  expect(attempt.status, JSON.stringify(attempt.body)).toBe(201);
  return bookingSummarySchema.parse(attempt.body);
};

beforeAll(async () => {
  if (!process.env.REDIS_URL)
    throw new Error('HB-126 requires PostgreSQL16 + Redis7; no skip fallback');
  const redisUrl = new URL(process.env.REDIS_URL);
  redisUrl.pathname = '/10';
  redis = new Redis(redisUrl.href);
  await redis.ping();

  // Toạ độ thật của ba cơ sở (BR-OVER-06): Đà Lạt–Vũng Tàu–Phan Thiết cách nhau 160–300 km.
  await rows('UPDATE properties SET latitude=11.940, longitude=108.440 WHERE id=$1', [propertyId]);
  await rows('UPDATE properties SET latitude=10.346, longitude=107.084 WHERE id=$1', [
    otherPropertyId,
  ]);
  thirdPropertyId = await insert(
    `INSERT INTO properties(code,name,address,phone,latitude,longitude)
     VALUES('H126-C','Synthetic H126-C','Synthetic address','+84900000126',10.933,108.287) RETURNING id`,
  );
  thirdTypeId = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price)
     VALUES($1,'STD','Synthetic STD third',2,100000,90000,200000) RETURNING id`,
    [thirdPropertyId],
  );
  thirdRoomId = await insert(
    "INSERT INTO rooms(property_id,room_type_id,code,name,floor,bed_count) VALUES($1,$2,'C1','C1',1,1) RETURNING id",
    [thirdPropertyId, thirdTypeId],
  );
  // Hạng cao hơn cùng cơ sở để bậc 2 (`UPGRADE_SAME_PROPERTY`) có đơn vị bán trống thật.
  upgradeTypeId = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price)
     VALUES($1,'DLX','Synthetic DLX',3,500000,300000,900000) RETURNING id`,
    [propertyId],
  );
  upgradeRoomId = await insert(
    "INSERT INTO rooms(property_id,room_type_id,code,name,floor,bed_count) VALUES($1,$2,'DLX1','DLX1',2,1) RETURNING id",
    [propertyId, upgradeTypeId],
  );
  // Chính sách H034 của seed dùng chung chưa có bậc huỷ; F4 `loadPolicySnapshot` đúng luật từ chối
  // policy rỗng (`E_RATE_CONFIGURATION_INVALID`) trước khi tạo booking. Bổ sung bậc tối thiểu, không
  // sửa seed của suite khác.
  await rows(
    `INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order)
     SELECT p.id, v.offset_hours, v.refund_percent, v.charge_first_night, v.label, v.sort_order
       FROM cancellation_policies p
      CROSS JOIN (VALUES (168,100,false,'>=7d',1),(72,50,false,'3-7d',2),
                         (24,0,false,'1-3d',3),(-1,0,true,'<24h',4))
        AS v(offset_hours,refund_percent,charge_first_night,label,sort_order)
      WHERE p.code='H034'
     ON CONFLICT (policy_id, offset_hours) DO NOTHING`,
  );
  const stored = await rows(
    'SELECT (SELECT count(*)::int FROM properties) AS properties, (SELECT count(*)::int FROM rooms WHERE property_id=$1) AS rooms',
    [propertyId],
  );
  expect(stored[0]).toMatchObject({ properties: 3, rooms: 4 });

  const registered = AppModule.register({
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl.href,
    JWT_ACCESS_SECRET: secrets.access,
    JWT_REFRESH_SECRET: secrets.refresh,
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
  await rows('UPDATE channels SET hold_minutes=$1 WHERE code=$2', [20, 'WEB']);
}, 120000);

beforeEach(async () => {
  clock.value = vn(TODAY, '09:00:00');
  await redis.flushdb();
  await rows('UPDATE properties SET overbook_limit_pct=0');
  await rows('UPDATE channels SET overbook_allowed=false');
  await rows('DELETE FROM user_property_scopes WHERE user_id IN ($1::uuid,$2::uuid)', [
    userId,
    secondUserId,
  ]);
  await rows(
    'INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$3::uuid),($2::uuid,$3::uuid)',
    [userId, secondUserId, propertyId],
  );
  await rows('DELETE FROM outbox_events');
  await rows('DELETE FROM notifications');
  await rows('UPDATE users SET is_active=true');
}, 30000);

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
