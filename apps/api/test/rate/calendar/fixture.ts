/**
 * Fixture tích hợp HB-054: app thật (`AppModule.register`) + CSDL tách riêng của
 * `test/idempotency/database.ts`, thêm dữ liệu giá tối thiểu (kênh, loại phòng, gói giá) đúng
 * thang giá BR-RATE-03/04 để kiểm sàn–trần. Redis dùng DB 12 (riêng suite này).
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../../src/app.module.js';
import { CLOCK } from '../../../src/infrastructure/ports.js';
import {
  clock,
  databaseUrl,
  password,
  propertyId,
  otherPropertyId,
  rows,
  userId,
} from '../../idempotency/database.js';

let app: NestFastifyApplication, redis: Redis;

export {
  clock,
  databaseUrl,
  otherPropertyId,
  propertyId,
  rows,
  userId,
} from '../../idempotency/database.js';

export const http = () => request(app.getHttpServer());

export async function login(role = 'MANAGER'): Promise<string> {
  await rows('UPDATE users SET role=$1 WHERE id=$2', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

/** Loại phòng `STD` của cơ sở chính — sàn/trần theo BR-RATE-04. */
export let typeId = '',
  /** Loại phòng `DLX` của cơ sở chính. */
  deluxeTypeId = '',
  /** Loại phòng của cơ sở **ngoài** phạm vi người dùng, để kiểm `E_AUTH_OUT_OF_SCOPE`. */
  otherTypeId = '';
export let ratePlanId = '',
  longstayPlanId = '';
let policyId = '';

export const STD = { basePrice: 650_000, minPrice: 400_000, maxPrice: 1_800_000 } as const;

async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB054 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/12';
  redis = new Redis(url.href);
  await redis.ping();
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

  policyId = await insert(
    "INSERT INTO cancellation_policies(code,name) VALUES('HB054-CP','Synthetic HB054') RETURNING id",
  );
  for (const plan of [
    { code: 'FLEX7', name: 'Linh hoạt 7 ngày', minNights: 1 },
    { code: 'LONGSTAY14', name: 'Dài ngày 14 đêm', minNights: 14 },
  ]) {
    const id = await insert(
      'INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id,los_discount_enabled,min_nights,max_nights) VALUES($1,$2,30,$3,true,$4,365) RETURNING id',
      [plan.code, plan.name, policyId, plan.minNights],
    );
    if (plan.code === 'FLEX7') ratePlanId = id;
    if (plan.code === 'LONGSTAY14') longstayPlanId = id;
  }
  // Hệ số/hoa hồng theo BR-RATE-07 tối thiểu để engine qua được kiểm sàn hoa hồng.
  await insert(
    "INSERT INTO channels(code,name,multiplier,commission_pct) VALUES('WEB','Website trực tiếp',1,0) RETURNING id",
  );
  await insert(
    "INSERT INTO channels(code,name,multiplier,commission_pct) VALUES('OTA_BOOKING','Booking.com',1.25,18) RETURNING id",
  );
  typeId = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Standard',2,650000,400000,1800000) RETURNING id",
    [propertyId],
  );
  deluxeTypeId = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'DLX','Deluxe',3,1100000,680000,3000000) RETURNING id",
    [propertyId],
  );
  otherTypeId = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Standard',2,650000,400000,1800000) RETURNING id",
    [otherPropertyId],
  );
}, 60000);

beforeEach(async () => {
  await redis.flushdb();
  // Bảng giá/mùa công suất là dữ liệu của từng ca; booking kéo theo snapshot đã chốt.
  await rows('TRUNCATE bookings CASCADE');
  await rows('TRUNCATE rate_calendars, seasons, occupancy_snapshots');
  await rows('DELETE FROM outbox_events');
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);

export interface SnapshotFacts {
  readonly bookingId: string;
  readonly snapshotId: string;
}

/** Booking đã chốt kèm `price_snapshots` (BR-RATE-16) — payload mang giá từng đêm tại thời điểm chốt. */
export async function bookedSnapshot(payload: Record<string, unknown>): Promise<SnapshotFacts> {
  const guestId = await insert(
    "INSERT INTO guests(full_name,phone) VALUES('Synthetic HB054','+84900000054') RETURNING id",
  );
  const channelId = String((await rows("SELECT id FROM channels WHERE code='WEB'"))[0]!.id);
  const bookingId = await insert(
    "INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent,status,total_amount,paid_amount) VALUES($1,$2,$3,$4,$5,$6,'2026-12-24','2026-12-26',2,30,'CONFIRMED',2600000,2600000) RETURNING id",
    [
      `PH-261224-${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`,
      guestId,
      propertyId,
      typeId,
      ratePlanId,
      channelId,
    ],
  );
  await rows(
    'INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night) VALUES($1,$2,2,1300000)',
    [bookingId, typeId],
  );
  const snapshotId = await insert(
    "INSERT INTO price_snapshots(booking_id,seq,payload_json,gross_amount,commission_amount,policy_snapshot_json,engine_version) VALUES($1,1,$2::jsonb,2600000,0,$3::jsonb,'hb054-test') RETURNING id",
    [bookingId, JSON.stringify(payload), JSON.stringify({ tiers: [] })],
  );
  return { bookingId, snapshotId };
}

/** Dòng lịch giá/mùa dựng thẳng bằng SQL để kiểm đúng hàm phân giải của engine. */
export async function insertCalendar(values: {
  roomTypeId?: string;
  property?: string;
  date: string;
  price: number;
  source: 'BASE' | 'SEASON' | 'OVERRIDE';
  channelCode?: string | null;
  seasonId?: string | null;
  reason?: string | null;
  createdAt?: string;
}): Promise<string> {
  const priority = values.source === 'OVERRIDE' ? 100 : values.source === 'SEASON' ? 50 : 10;
  return insert(
    'INSERT INTO rate_calendars(room_type_id,property_id,date,price,source,priority,channel_code,season_id,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
    [
      values.roomTypeId ?? typeId,
      values.property ?? propertyId,
      values.date,
      values.price,
      values.source,
      priority,
      values.channelCode ?? null,
      values.seasonId ?? null,
      values.reason ?? null,
      values.createdAt ?? new Date().toISOString(),
    ],
  );
}

export async function insertSeason(values: {
  property?: string | null;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  multiplier: number;
  priority: number;
  weekendSurchargeEnabled?: boolean;
  createdAt?: string;
}): Promise<string> {
  return insert(
    'INSERT INTO seasons(property_id,code,name,start_date,end_date,multiplier,priority,weekend_surcharge_enabled,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [
      values.property === undefined ? propertyId : values.property,
      values.code,
      values.name,
      values.startDate,
      values.endDate,
      values.multiplier,
      values.priority,
      values.weekendSurchargeEnabled ?? true,
      values.createdAt ?? new Date().toISOString(),
    ],
  );
}

export async function insertOccupancy(values: {
  date: string;
  sold: number;
  physical: number;
  capturedAt: string;
}): Promise<string> {
  // `occupancy_pct` tính ở JS (chỉ dùng cho fixture); giữ tham số SQL cùng kiểu để PG không suy kiểu chéo.
  const percent = Math.round((values.sold * 10000) / Math.max(values.physical, 1)) / 100;
  return insert(
    'INSERT INTO occupancy_snapshots(property_id,room_type_id,date,physical_rooms,sold_rooms,occupancy_pct,captured_at) VALUES($1,NULL,$2,$3::smallint,$4::smallint,$5::numeric,$6) RETURNING id',
    [propertyId, values.date, values.physical, values.sold, percent, values.capturedAt],
  );
}
