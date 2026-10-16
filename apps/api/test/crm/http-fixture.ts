import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { z } from 'zod';
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

/** PII gốc của hồ sơ dùng cho ca ẩn danh hoá; `beforeEach` khôi phục đúng bộ giá trị này. */
export const guestProfile = {
  fullName: 'Khách Có Dữ Liệu Cá Nhân',
  email: 'pii.hb166@example.com',
  idNumber: '012345678901',
  dob: '1988-04-15',
  notes: 'Ghi chú nội bộ: khách gọi +84900000201',
  blacklistReason: 'Phá phòng 201',
} as const;

export const guests = {
  anonymizePhone: '+84900000201',
  outsidePhone: '+84900000202',
  loyaltyPhone: '+84900000203',
  blacklistPhone: '+84900000204',
  blockedPhone: '+84900000205',
  noBookingPhone: '+84900000206',
} as const;

export let anonymizeId = '',
  outsideId = '',
  loyaltyId = '',
  blacklistId = '',
  blockedId = '',
  noBookingId = '';

export async function login(role = 'FRONT_DESK'): Promise<string> {
  clock.value += 61000;
  await rows('UPDATE users SET role=$1 WHERE id=$2', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

/** Ba tuyến quản trị của HB-166; thao tác ghi mang `Idempotency-Key` như mọi lệnh ghi khác (api.md §3). */
export const admin = {
  anonymize: (token: string, guestId: string, body: object) =>
    http()
      .post(`/api/v1/guests/${guestId}/anonymize`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body),
  loyalty: (token: string, guestId: string) =>
    http().get(`/api/v1/guests/${guestId}/loyalty`).set('Authorization', `Bearer ${token}`),
  addBlacklist: (token: string, guestId: string, body: object) =>
    http()
      .post(`/api/v1/guests/${guestId}/blacklist`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body),
  releaseBlacklist: (token: string, guestId: string, query: Record<string, string>) =>
    http()
      .delete(`/api/v1/guests/${guestId}/blacklist`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .query(query),
};

/** Ảnh chụp hồ sơ để khẳng định cột nào đổi; lấy theo `id` vì SĐT đổi sau ẩn danh hoá. Cột hồ sơ parse
 * bằng zod để test không phải `as` (QT §2) và lệch lược đồ bị bắt sớm. */
const guestRowSchema = z.object({
  full_name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  id_number: z.string().nullable(),
  dob: z.date().nullable(),
  nationality: z.string().nullable(),
  gender: z.string(),
  notes: z.string().nullable(),
  blacklisted: z.boolean(),
  blacklist_reason: z.string().nullable(),
  anonymized_at: z.date().nullable(),
  updated_at: z.date(),
  loyalty_tier: z.string(),
  loyalty_points: z.number(),
  total_stays: z.number(),
});
export type GuestRow = z.infer<typeof guestRowSchema>;

export async function guestById(id: string): Promise<GuestRow> {
  const [row] = await rows(
    `SELECT full_name, phone, email, id_number, dob, nationality, gender, notes, blacklisted,
            blacklist_reason, anonymized_at, updated_at, loyalty_tier, loyalty_points, total_stays
       FROM guests WHERE id=$1`,
    [id],
  );
  return guestRowSchema.parse(row);
}

export function auditEntries(action: string, entityId: string) {
  return rows(
    `SELECT before_json::text AS "before", after_json::text AS "after", reason
       FROM audit_logs WHERE action=$1 AND entity_id=$2`,
    [action, entityId],
  );
}

export async function auditTotal(action: string): Promise<number> {
  return Number(
    (await rows('SELECT count(*) AS n FROM audit_logs WHERE action=$1', [action]))[0]!.n,
  );
}

async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

interface GuestSeed {
  email?: string | null;
  idNumber?: string | null;
  dob?: string | null;
  notes?: string | null;
  blacklisted?: boolean;
  blacklistReason?: string | null;
  loyaltyTier?: string;
  loyaltyPoints?: number;
  totalStays?: number;
}

async function seedGuest(phone: string, fullName: string, seed: GuestSeed = {}): Promise<string> {
  const values = {
    email: null,
    idNumber: null,
    dob: null,
    notes: null,
    blacklisted: false,
    blacklistReason: null,
    loyaltyTier: 'GUEST',
    loyaltyPoints: 0,
    totalStays: 0,
    ...seed,
  };
  return insert(
    `INSERT INTO guests(full_name,phone,email,id_number,dob,nationality,notes,blacklisted,blacklist_reason,
                        loyalty_tier,loyalty_points,total_stays)
     VALUES($1,$2,$3,$4,$5::date,'VN',$6,$7,CASE WHEN $7 THEN $8 END,$9,$10,$11) RETURNING id`,
    [
      fullName,
      phone,
      values.email,
      values.idNumber,
      values.dob,
      values.notes,
      values.blacklisted,
      values.blacklistReason,
      values.loyaltyTier,
      values.loyaltyPoints,
      values.totalStays,
    ],
  );
}

let ratePlan = '',
  channel = '',
  typeA = '',
  typeB = '';

async function seedBooking(
  guest: string,
  property: string,
  roomType: string,
  checkIn: string,
  checkOut: string,
  status: string,
): Promise<string> {
  return insert(
    `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,
                          check_in,check_out,adults,deposit_percent,status,cancelled_at)
     VALUES('PH-' || lpad((floor(random()*999999))::text,6,'0') || '-' || upper(substr(md5(random()::text),1,5)),
            $1,$2,$3,$4,$5,$6::date,$7::date,2,30,$8,
            CASE WHEN $8 = 'CANCELLED' THEN now() END) RETURNING id`,
    [guest, property, roomType, ratePlan, channel, checkIn, checkOut, status],
  );
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-166 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  // Cả họ fixture tích hợp chia dải DB Redis (7, 10…15); HB-166 sở hữu riêng DB 9.
  url.pathname = '/9';
  redis = new Redis(url.href);
  await redis.ping();

  const policy = await insert(
    "INSERT INTO cancellation_policies(code,name) VALUES('HB166','Synthetic HB-166') RETURNING id",
  );
  ratePlan = await insert(
    "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('FLEX7','Linh hoạt',30,$1) RETURNING id",
    [policy],
  );
  channel = await insert(
    "INSERT INTO channels(code,name,multiplier) VALUES('WEB','WEB',1) RETURNING id",
  );
  typeA = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Tiêu chuẩn',2,1000000,500000,2000000) RETURNING id",
    [propertyId],
  );
  typeB = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Tiêu chuẩn',2,1000000,500000,2000000) RETURNING id",
    [otherPropertyId],
  );

  anonymizeId = await seedGuest(guests.anonymizePhone, guestProfile.fullName, {
    email: guestProfile.email,
    idNumber: guestProfile.idNumber,
    dob: guestProfile.dob,
    notes: guestProfile.notes,
    blacklisted: true,
    blacklistReason: guestProfile.blacklistReason,
    loyaltyTier: 'GOLD',
    loyaltyPoints: 400,
    totalStays: 12,
  });
  outsideId = await seedGuest(guests.outsidePhone, 'Khách Cơ Sở Khác');
  loyaltyId = await seedGuest(guests.loyaltyPhone, 'Khách Tích Điểm', {
    loyaltyTier: 'SILVER',
    loyaltyPoints: 120,
    totalStays: 9,
  });
  blacklistId = await seedGuest(guests.blacklistPhone, 'Khách Sắp Bị Chặn');
  blockedId = await seedGuest(guests.blockedPhone, 'Khách Đang Bị Chặn', {
    blacklisted: true,
    blacklistReason: 'Đã chặn trước đó',
  });
  noBookingId = await seedGuest(guests.noBookingPhone, 'Khách Chưa Có Booking');

  // Hồ sơ ẩn danh hoá có booking + thanh toán để khẳng định chúng được giữ nguyên (TC-CRM-05).
  const kept = await seedBooking(
    anonymizeId,
    propertyId,
    typeA,
    '2026-08-01',
    '2026-08-03',
    'CHECKED_OUT',
  );
  await seedBooking(anonymizeId, propertyId, typeA, '2026-12-20', '2026-12-22', 'CONFIRMED');
  await insert(
    `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at)
     VALUES($1,'DEPOSIT','BANK_TRANSFER',500000,'SUCCEEDED','HB166-SEED-1',now()) RETURNING id`,
    [kept],
  );
  await insert(
    'INSERT INTO guest_notes(guest_id,content,author_id) VALUES($1,$2,$3) RETURNING id',
    [anonymizeId, 'Khách Nguyễn Văn A gọi tới số +84900000201', userId],
  );
  await insert(
    "INSERT INTO loyalty_transactions(guest_id,type,points,reason) VALUES($1,'ADJUST',10,$2) RETURNING id",
    [anonymizeId, 'Khách Nguyễn Văn A xin cộng điểm'],
  );

  await seedBooking(outsideId, otherPropertyId, typeB, '2026-11-01', '2026-11-03', 'CONFIRMED');
  await seedBooking(blacklistId, propertyId, typeA, '2026-11-05', '2026-11-06', 'CONFIRMED');
  await seedBooking(blockedId, propertyId, typeA, '2026-11-07', '2026-11-08', 'CONFIRMED');

  // Loyalty: cửa sổ 12 tháng tính từ Clock (2026-10-09) → mốc 2025-10-09.
  await seedBooking(loyaltyId, propertyId, typeA, '2026-09-01', '2026-09-03', 'CHECKED_OUT');
  await seedBooking(loyaltyId, propertyId, typeA, '2026-10-01', '2026-10-03', 'CHECKED_IN');
  await seedBooking(loyaltyId, propertyId, typeA, '2026-09-10', '2026-09-12', 'CANCELLED');
  await seedBooking(loyaltyId, propertyId, typeA, '2026-09-20', '2026-09-22', 'NO_SHOW');
  await seedBooking(loyaltyId, propertyId, typeA, '2025-08-01', '2025-08-05', 'CHECKED_OUT');
  await seedBooking(loyaltyId, propertyId, typeA, '2025-10-09', '2025-10-10', 'CHECKED_OUT');

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
  // Bảng khách chỉ chèn một lần: mỗi ca khôi phục đúng trạng thái seed để ca này không phụ thuộc ca trước.
  await rows(
    `UPDATE guests SET full_name=$2, email=$3, id_number=$4, dob=$5::date, nationality='VN',
            gender='UNSPECIFIED', notes=$6, blacklisted=true, blacklist_reason=$7, anonymized_at=NULL,
            loyalty_tier='GOLD', loyalty_points=400, total_stays=12
       WHERE id=$1`,
    [
      anonymizeId,
      guestProfile.fullName,
      guestProfile.email,
      guestProfile.idNumber,
      guestProfile.dob,
      guestProfile.notes,
      guestProfile.blacklistReason,
    ],
  );
  await rows('UPDATE guest_notes SET content=$2 WHERE guest_id=$1', [
    anonymizeId,
    'Khách Nguyễn Văn A gọi tới số +84900000201',
  ]);
  await rows('UPDATE loyalty_transactions SET reason=$2 WHERE guest_id=$1', [
    anonymizeId,
    'Khách Nguyễn Văn A xin cộng điểm',
  ]);
  await rows('UPDATE guests SET blacklisted=false, blacklist_reason=NULL WHERE id=$1', [
    blacklistId,
  ]);
  await rows('UPDATE guests SET blacklisted=true, blacklist_reason=$2 WHERE id=$1', [
    blockedId,
    'Đã chặn trước đó',
  ]);
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
