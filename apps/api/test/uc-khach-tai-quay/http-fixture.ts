import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import {
  databaseUrl,
  password,
  rows,
  clock,
  userId,
  propertyId,
  otherPropertyId,
} from '../idempotency/database.js';

let app: NestFastifyApplication, redis: Redis;

export const http = () => request(app.getHttpServer());
export { db, rows, clock, userId, propertyId, otherPropertyId } from '../idempotency/database.js';

/** Hồ sơ khách tổng hợp: `scoped` có booking trong cơ sở, `unscoped` không booking nào. */
export const guests = {
  scopedName: 'Khách Trong Phạm Vi',
  scopedPhone: '+84900000101',
  otherPhone: '+84900000102',
  noBookingPhone: '+84900000103',
  blacklistedPhone: '+84900000104',
} as const;

export let scopedId = '',
  otherId = '',
  noBookingId = '',
  blacklistedId = '';

export async function login(role = 'FRONT_DESK'): Promise<string> {
  clock.value += 61000;
  await rows('UPDATE users SET role=$1 WHERE id=$2', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

export function createGuest(token: string, body: object) {
  return http()
    .post('/api/v1/guests')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);
}

export function listGuests(token: string, query: Record<string, string> = {}) {
  return http().get('/api/v1/guests').set('Authorization', `Bearer ${token}`).query(query);
}

async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

async function seedGuest(phone: string, fullName: string, blacklisted = false): Promise<string> {
  return insert(
    'INSERT INTO guests(full_name,phone,blacklisted,blacklist_reason) VALUES($1,$2,$3,CASE WHEN $3 THEN $4 END) RETURNING id',
    [fullName, phone, blacklisted, 'Synthetic blacklist reason'],
  );
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-149 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/10';
  redis = new Redis(url.href);
  await redis.ping();

  const policy = await insert(
    "INSERT INTO cancellation_policies(code,name) VALUES('HB149','Synthetic HB-149') RETURNING id",
  );
  const ratePlan = await insert(
    "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('FLEX7','Linh hoạt',30,$1) RETURNING id",
    [policy],
  );
  const channel = await insert(
    "INSERT INTO channels(code,name,multiplier) VALUES('WEB','WEB',1) RETURNING id",
  );
  const typeA = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Tiêu chuẩn',2,1000000,500000,2000000) RETURNING id",
    [propertyId],
  );
  const typeB = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Tiêu chuẩn',2,1000000,500000,2000000) RETURNING id",
    [otherPropertyId],
  );

  const stayScoped = await seedGuest(guests.scopedPhone, guests.scopedName);
  scopedId = stayScoped;
  otherId = await seedGuest(guests.otherPhone, 'Khách Cơ Sở Khác');
  noBookingId = await seedGuest(guests.noBookingPhone, 'Khách Chưa Có Booking');
  blacklistedId = await seedGuest(guests.blacklistedPhone, 'Khách Danh Sách Đen', true);

  const booking = async (guest: string, property: string, type: string) =>
    insert(
      `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent,status)
       VALUES('PH-' || lpad((floor(random()*999999))::text,6,'0') || '-' || upper(substr(md5(random()::text),1,5)),$1,$2,$3,$4,$5,'2026-11-01','2026-11-03',2,30,'CONFIRMED') RETURNING id`,
      [guest, property, type, ratePlan, channel],
    );
  await booking(scopedId, propertyId, typeA);
  await booking(otherId, otherPropertyId, typeB);
  await booking(blacklistedId, propertyId, typeA);

  const module = AppModule.register({
    DATABASE_URL: databaseUrl,
    REDIS_URL: url.href,
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
      ...module,
      providers: [
        ...(module.providers ?? []).filter(
          (p) => typeof p !== 'object' || p === null || !('provide' in p) || p.provide !== CLOCK,
        ),
        { provide: CLOCK, useValue: clock },
      ],
    },
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
}, 60000);

beforeEach(async () => {
  await redis.flushdb();
  // Hồ sơ tạo trong ca trước không được rò sang ca sau (bảng khách giữ nguyên bản ghi đã seed).
  await rows("DELETE FROM guests WHERE phone LIKE '+8490000019%'");
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
