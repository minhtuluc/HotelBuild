/**
 * Fixture HB-145 — app thật (`AppModule.register`) trên CSDL riêng của tệp test + Redis10, clock giả.
 *
 * Dữ liệu dựng đúng sổ nghĩa vụ (`booking_charges` ROOM + Payment SUCCEEDED/phân bổ) và snapshot ORIGINAL
 * để endpoint check-out đọc số dư/giá đêm cuối từ sổ thật. Policy HB145 cố ý có **bậc bắt tất 50%**
 * để ca trả phòng sớm chạm đường `recordRefund` (policy sản xuất NONREF/bắt tất 0% không lập hoàn).
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { errorBodySchema, pinTokenSchema, tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { clock, databaseUrl, password, propertyId, rows, userId } from '../idempotency/database.js';

export { clock, rows, userId } from '../idempotency/database.js';

export const CHECK_OUT = '/api/v1/front-office/check-out';
export const PIN = '145145';
export const D = '2026-11-10';
export const NIGHTLY = 1_100_000;
const DAY = 86_400_000;

let app: NestFastifyApplication;
let redis: Redis;
let ratePlanId = '',
  channelId = '',
  typeId = '',
  guestId = '';
let policyId = '';
let tierIds: string[] = [];

export let q1 = '',
  q2 = '',
  q3 = '';

export const http = () => request(app.getHttpServer());
export const day = (date: string, offset: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
export const vn = (date: string, time: string) => Date.parse(`${date}T${time}+07:00`);
export const errorCode = (response: { body: unknown }) => errorBodySchema.parse(response.body).code;

export async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

export async function staffToken(role: string): Promise<string> {
  await rows('UPDATE users SET role=$1,is_active=true WHERE id=$2', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

/** `pinToken` dùng một lần, gắn đúng booking (BR-RBAC-05). */
export async function mintPin(token: string, bookingId: string): Promise<string> {
  const response = await http()
    .post('/api/v1/auth/pin/verify')
    .set('Authorization', `Bearer ${token}`)
    .send({ pin: PIN, bookingId });
  expect(response.status).toBe(200);
  return pinTokenSchema.parse(response.body).pinToken;
}

export const postWith = (token: string, body: object, key: string) =>
  http()
    .post(CHECK_OUT)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send(body);

export const post = (token: string, body: object) => postWith(token, body, randomUUID());

export interface BookingOptions {
  status?: string;
  checkIn?: string;
  checkOut?: string;
  nightly?: number;
  paid?: number;
  assign?: string;
}

export interface SeededBooking {
  id: string;
  bookingRoomId: string;
  checkIn: string;
  checkOut: string;
}

const ROOM_CHARGE = `INSERT INTO booking_charges(booking_id,booking_room_id,stay_date,kind,source_key,amount)
  VALUES($1,$2,$3,'ROOM',$4,$5) RETURNING id`;
const PAYMENT = `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
  VALUES($1,'DEPOSIT','BANK_TRANSFER',$2,'SUCCEEDED',$3,clock_timestamp(),$4) RETURNING id`;
const ALLOCATE = 'INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1,$2,$3)';

/** Nghĩa vụ ROOM từng đêm + Payment SUCCEEDED đã phân bổ (BR-PAY-02). */
async function insertLedger(
  id: string,
  bookingRoomId: string,
  checkIn: string,
  nightly: number,
  nights: number,
  paid: number,
): Promise<void> {
  const charges: string[] = [];
  for (let night = 0; night < nights; night += 1) {
    const stayDate = day(checkIn, night);
    charges.push(
      await insert(ROOM_CHARGE, [
        id,
        bookingRoomId,
        stayDate,
        `room:${bookingRoomId}:${stayDate}`,
        nightly,
      ]),
    );
  }
  if (paid <= 0) return;
  const payment = await insert(PAYMENT, [id, paid, randomUUID(), userId]);
  let left = paid;
  for (const charge of charges) {
    if (left <= 0) break;
    const amount = Math.min(left, nightly);
    await rows(ALLOCATE, [payment, charge, amount]);
    left -= amount;
  }
}

/** `price_snapshots` ORIGINAL theo csdl §3.6, bậc lấy id thật để `RefundRequest.appliedTierId` hợp lệ. */
async function insertSnapshot(
  id: string,
  bookingRoomId: string,
  checkIn: string,
  checkOut: string,
  nightly: number,
  nights: number,
): Promise<void> {
  const policy = {
    id: policyId,
    code: 'HB145',
    version: 1,
    tiers: [
      { id: tierIds[0], offsetHours: 168, refundPercent: 100, chargeFirstNight: false },
      { id: tierIds[1], offsetHours: 72, refundPercent: 100, chargeFirstNight: false },
      { id: tierIds[2], offsetHours: 24, refundPercent: 50, chargeFirstNight: false },
      { id: tierIds[3], offsetHours: -1, refundPercent: 50, chargeFirstNight: false },
    ],
  };
  const gross = nightly * nights;
  const payload = {
    schemaVersion: 1,
    engineVersion: 'hb145-test',
    ratePlan: { id: ratePlanId, code: 'FLEX7', version: 1, depositPercent: 30 },
    policy,
    stay: {
      checkIn,
      checkOut,
      timezone: 'Asia/Ho_Chi_Minh',
      checkInTime: '14:00:00',
      checkOutTime: '12:00:00',
    },
    nights: Array.from({ length: nights }, (_unused, index) => ({
      bookingRoomId,
      date: day(checkIn, index),
      nightlyPrice: nightly,
      grossAmount: nightly,
    })),
    totals: {
      subtotal: gross,
      discountAmount: 0,
      grossAmount: gross,
      commissionAmount: 0,
      depositAmount: Math.ceil(gross * 0.3),
      currency: 'VND',
    },
  };
  await rows(
    `INSERT INTO price_snapshots(booking_id,seq,kind,payload_json,gross_amount,commission_amount,
        policy_snapshot_json,engine_version)
     VALUES($1,1,'ORIGINAL',$2::jsonb,$3,0,$4::jsonb,'hb145-test')`,
    [id, JSON.stringify(payload), gross, JSON.stringify(policy)],
  );
}

export async function seedBooking(options: BookingOptions = {}): Promise<SeededBooking> {
  const status = options.status ?? 'CONFIRMED';
  const checkIn = options.checkIn ?? D;
  const checkOut = options.checkOut ?? day(checkIn, 2);
  const nightly = options.nightly ?? NIGHTLY;
  const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY);
  const total = nightly * nights;
  const paid = options.paid ?? 0;
  const code = `PH-${checkIn.slice(2).replaceAll('-', '')}-${randomUUID().slice(0, 5).toUpperCase()}`;
  const id = await insert(
    `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,
        check_in,check_out,adults,deposit_percent,status,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,30,$9,$10) RETURNING id`,
    [code, guestId, propertyId, typeId, ratePlanId, channelId, checkIn, checkOut, status, userId],
  );
  const bookingRoomId = await insert(
    'INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night) VALUES($1,$2,1,$3) RETURNING id',
    [id, typeId, nightly],
  );
  await insertLedger(id, bookingRoomId, checkIn, nightly, nights, paid);
  await rows('UPDATE bookings SET total_amount=$2,paid_amount=$3,balance_due=$4 WHERE id=$1', [
    id,
    total,
    paid,
    total - paid,
  ]);
  if (options.assign)
    await rows(
      'INSERT INTO room_assignments(booking_room_id,room_id,bed_no,start_date,end_date) VALUES($1,$2,0,$3,$4)',
      [bookingRoomId, options.assign, checkIn, checkOut],
    );
  await insertSnapshot(id, bookingRoomId, checkIn, checkOut, nightly, nights);
  return { id, bookingRoomId, checkIn, checkOut };
}

/** Đang ở; mặc định 1 đêm (D−1 → D) đã thu đủ như bộ test khoá. */
export const checkedIn = (room: string, paid = NIGHTLY, checkIn = day(D, -1), checkOut = D) =>
  seedBooking({ status: 'CHECKED_IN', checkIn, checkOut, paid, assign: room });

export const checkOutBody = (seed: SeededBooking, pinToken?: string) => ({
  bookingId: seed.id,
  lateCheckOut: true,
  earlyCheckOut: false,
  ...(pinToken ? { pinToken } : {}),
});

export const bookingRow = async (id: string) => {
  const found = await rows(
    'SELECT status,total_amount,paid_amount,balance_due,penalty_amount FROM bookings WHERE id=$1',
    [id],
  );
  expect(found).toHaveLength(1);
  return found[0]!;
};

export const unreleased = (bookingRoomId: string) =>
  rows('SELECT id FROM room_assignments WHERE booking_room_id=$1 AND released_at IS NULL', [
    bookingRoomId,
  ]);

export const releaseRow = async (bookingRoomId: string) =>
  (
    await rows('SELECT released_at,release_reason FROM room_assignments WHERE booking_room_id=$1', [
      bookingRoomId,
    ])
  )[0]!;

export const roomTasks = (roomId: string, businessDate: string) =>
  rows('SELECT id,status FROM housekeeping_tasks WHERE room_id=$1 AND business_date=$2', [
    roomId,
    businessDate,
  ]);

export const history = (bookingId: string, toStatus?: string) =>
  rows(
    toStatus
      ? 'SELECT id,at FROM booking_status_history WHERE booking_id=$1 AND to_status=$2'
      : 'SELECT id FROM booking_status_history WHERE booking_id=$1',
    toStatus ? [bookingId, toStatus] : [bookingId],
  );

export const charges = (bookingId: string, kind?: string) =>
  rows(
    `SELECT id,kind,amount,voided_amount,source_key,reason FROM booking_charges
      WHERE booking_id=$1 ${kind ? 'AND kind=$2' : ''} ORDER BY source_key,id`,
    kind ? [bookingId, kind] : [bookingId],
  );

export const outbox = (bookingId: string) =>
  rows(
    "SELECT id,event_type,payload_json FROM outbox_events WHERE aggregate_id=$1 AND event_type='InventoryChanged'",
    [bookingId],
  );

export const refunds = (bookingId: string) =>
  rows(
    'SELECT id,status,reason,requested_amount,refund_percent,applied_tier_id FROM refund_requests WHERE booking_id=$1',
    [bookingId],
  );

const checkoutAudits = (id: string) =>
  rows(
    `SELECT id FROM audit_logs WHERE entity_id=$1
       AND concat(coalesce(before_json::text,''),coalesce(after_json::text,'')) LIKE '%CHECKED_OUT%'`,
    [id],
  );

export const checkoutAuditCount = async (id: string) => (await checkoutAudits(id)).length;

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-145 requires PG16 + Redis7; no skip fallback');
  const redisUrl = new URL(process.env.REDIS_URL);
  redisUrl.pathname = '/10';
  redis = new Redis(redisUrl.href);
  await redis.ping();

  policyId = await insert(
    "INSERT INTO cancellation_policies(code,name) VALUES('HB145','Synthetic HB-145') RETURNING id",
  );
  tierIds = [];
  for (const [offset, percent, order] of [
    [168, 100, 1],
    [72, 100, 2],
    [24, 50, 3],
    [-1, 50, 4],
  ] as const)
    tierIds.push(
      await insert(
        `INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order)
         VALUES($1,$2,$3,false,$4,$5) RETURNING id`,
        [policyId, offset, percent, `${offset}h`, order],
      ),
    );
  ratePlanId = await insert(
    `INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id)
     VALUES('FLEX7','Synthetic FLEX7',30,$1) RETURNING id`,
    [policyId],
  );
  channelId = await insert(
    "INSERT INTO channels(code,name,multiplier) VALUES('WEB','Web',1) RETURNING id",
  );
  typeId = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price)
     VALUES($1,'STD','Synthetic STD',2,$2,400000,3000000) RETURNING id`,
    [propertyId, NIGHTLY],
  );
  guestId = await insert(
    "INSERT INTO guests(full_name,phone) VALUES('Synthetic HB-145','+84900000145') RETURNING id",
  );
  const roomIds: string[] = [];
  for (const code of ['Q1', 'Q2', 'Q3'])
    roomIds.push(
      await insert(
        `INSERT INTO rooms(property_id,room_type_id,code,name,floor,bed_count)
         VALUES($1,$2,$3,$3,1,1) RETURNING id`,
        [propertyId, typeId, code],
      ),
    );
  [q1, q2, q3] = [roomIds[0]!, roomIds[1]!, roomIds[2]!];

  const registered = AppModule.register({
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl.href,
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

  const token = await staffToken('FRONT_DESK');
  const pin = await http()
    .put('/api/v1/auth/pin')
    .set('Authorization', `Bearer ${token}`)
    .send({ pin: PIN, currentPassword: password });
  expect(pin.status).toBe(204);
}, 90000);

beforeEach(async () => {
  clock.value = vn(D, '10:00:00');
  await redis.flushdb();
  await rows('TRUNCATE bookings CASCADE');
  await rows('DELETE FROM housekeeping_tasks');
  await rows('DELETE FROM idempotency_keys');
  await rows("UPDATE rooms SET status='ACTIVE'");
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
