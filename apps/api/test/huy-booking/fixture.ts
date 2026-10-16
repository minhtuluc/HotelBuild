/**
 * HB-097 fixture — CSDL riêng cho file test (tạo mới + migrate), app HTTP thật, Redis DB riêng `/12`,
 * clock giả điều khiển được (đổi mốc giờ giữa xem trước và xác nhận cho AC1).
 * Dữ liệu nền phòng/loại phòng dùng lại `../room-blocks/inventory-seed.js`.
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { errorBodySchema, tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { BookingLedger } from '../../src/modules/pay/ledger/service.js';
import { databaseUrl, password } from '../idempotency/database.js';
import {
  rows,
  roomId,
  room2Id,
  userId,
  propertyId,
  db,
  clock,
  stay,
} from '../room-blocks/inventory-seed.js';

export { rows, roomId, room2Id, userId, propertyId, db, clock, stay };
export const ledger = new BookingLedger(clock);

let app: NestFastifyApplication;
let redis: Redis;

export const http = () => request(app.getHttpServer());

export async function login(role = 'FRONT_DESK'): Promise<string> {
  await rows("UPDATE users SET role=$1,is_active=true WHERE username='h029-first'", [role]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB097 requires Redis7; no skip fallback');
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
}, 90000);

beforeEach(async () => {
  await redis.flushdb();
  await rows("DELETE FROM system_settings WHERE key='refund.feeAmount'");
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);

export const errorCode = (body: unknown) => errorBodySchema.parse(body).code;
export const guestCancel = { reason: 'GUEST_REQUEST', isForceMajeure: false };
export const setFee = (amount: number) =>
  rows(
    `INSERT INTO system_settings(key,value,value_type) VALUES('refund.feeAmount',$1,'NUMBER')
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [amount.toString()],
  );
export const bookingRow = async (id: string) =>
  (
    await rows(
      `SELECT status,version,total_amount,paid_amount,balance_due,penalty_amount,cancel_reason,cancelled_at
         FROM bookings WHERE id=$1`,
      [id],
    )
  )[0]!;
export const auditCount = async (id: string, action: string) =>
  Number(
    (
      await rows('SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1 AND action=$2', [
        id,
        action,
      ])
    )[0]!.n,
  );
export const refundRequests = (id: string) =>
  rows('SELECT * FROM refund_requests WHERE booking_id=$1', [id]);
export const heldAmount = async (id: string) =>
  (
    await rows(
      `SELECT coalesce(sum(amount),0)::text AS held FROM refund_allocations
        WHERE refund_request_id IN (SELECT id FROM refund_requests WHERE booking_id=$1)`,
      [id],
    )
  )[0]!.held;

export const preview = (
  token: string,
  id: string,
  body: object = { reason: 'GUEST_REQUEST', isForceMajeure: false },
) =>
  http()
    .post(`/api/v1/bookings/${id}/cancel-preview`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

export const cancel = (
  token: string,
  id: string,
  body: object,
  options: { tag?: string; key?: string } = {},
) => {
  const pending = http()
    .post(`/api/v1/bookings/${id}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', options.key ?? randomUUID());
  if (options.tag !== undefined) pending.set('If-Match', options.tag);
  return pending.send(body);
};

/** Bậc huỷ của FLEX7 (§6.1) đúng như seed gói giá dùng trong test. */
export async function flexPolicy(): Promise<string> {
  const policy = String(
    (await rows("SELECT cancellation_policy_id AS id FROM rate_plans WHERE code='FLEX7'"))[0]!.id,
  );
  if (!(await rows('SELECT id FROM cancellation_tiers WHERE policy_id=$1', [policy])).length)
    await rows(
      `INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order)
       VALUES ($1::uuid,168,100,false,'>=7d',1),($1::uuid,72,50,false,'3-7d',2),
              ($1::uuid,24,0,false,'1-3d',3),($1::uuid,-1,0,true,'<24h',4)`,
      [policy],
    );
  return policy;
}

export interface BookingInput {
  status?: string;
  rooms?: readonly string[];
  nights?: number;
  checkIn?: string;
  price?: number;
  holdExpiresAt?: Date | null;
}

export interface PolicySnapshot {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly earlyCheckoutFreeHours: number | null;
  readonly earlyCheckoutRefundPct: number;
  readonly tiers: readonly {
    readonly id: unknown;
    readonly offsetHours: unknown;
    readonly refundPercent: number;
    readonly chargeFirstNight: unknown;
  }[];
}

async function insertPolicy(policyId: string): Promise<PolicySnapshot> {
  const tiers = await rows(
    'SELECT id,offset_hours,refund_percent,charge_first_night FROM cancellation_tiers WHERE policy_id=$1 ORDER BY sort_order',
    [policyId],
  );
  return {
    id: policyId,
    code: 'FLEX7',
    version: 1,
    earlyCheckoutFreeHours: null,
    earlyCheckoutRefundPct: 0,
    tiers: tiers.map((tier) => ({
      id: tier.id,
      offsetHours: tier.offset_hours,
      refundPercent: Number(tier.refund_percent),
      chargeFirstNight: tier.charge_first_night,
    })),
  };
}

/** `price_snapshots` ORIGINAL theo csdl §3.6 (policy + stay + nights + totals) — bản gốc bất biến. */
async function insertSnapshot(input: {
  id: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  price: number;
  total: bigint;
  policy: PolicySnapshot;
  bookingRooms: readonly string[];
}) {
  const day = (offset: number) =>
    new Date(Date.parse(`${input.checkIn}T00:00:00Z`) + offset * 86_400_000)
      .toISOString()
      .slice(0, 10);
  const nights = input.bookingRooms.flatMap((bookingRoom) =>
    Array.from({ length: input.nights }, (_unused, night) => ({
      bookingRoomId: bookingRoom,
      date: day(night),
      grossAmount: input.price,
    })),
  );
  await rows(
    `INSERT INTO price_snapshots(booking_id,seq,kind,payload_json,gross_amount,commission_amount,
        policy_snapshot_json,engine_version)
     VALUES($1::uuid,1,'ORIGINAL',$2::jsonb,$3,0,$4::jsonb,'hb097-test')`,
    [
      input.id,
      JSON.stringify({
        schemaVersion: 1,
        ratePlan: { id: 'rate-plan', code: 'FLEX7', version: 1 },
        policy: input.policy,
        stay: {
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          timezone: 'Asia/Ho_Chi_Minh',
          checkInTime: '14:00:00',
          checkOutTime: '12:00:00',
        },
        nights,
        totals: {
          subtotal: Number(input.total),
          discountAmount: 0,
          grossAmount: Number(input.total),
          commissionAmount: 0,
          depositAmount: 0,
          currency: 'VND',
        },
      }),
      input.total.toString(),
      JSON.stringify(input.policy),
    ],
  );
}

/** BookingRoom + nghĩa vụ ROOM mỗi phòng–đêm (đơn giá đã chốt, không đổi khi huỷ). */
async function insertRooms(
  id: string,
  rooms: readonly string[],
  nights: number,
  price: number,
  day: (offset: number) => string,
): Promise<Map<string, string>> {
  const bookingRooms = new Map<string, string>();
  for (const room of rooms) {
    const bookingRoom = String(
      (
        await rows(
          `INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night)
           SELECT $1,room_type_id,1,$3 FROM rooms WHERE id=$2::uuid RETURNING id`,
          [id, room, price],
        )
      )[0]!.id,
    );
    bookingRooms.set(room, bookingRoom);
    for (let night = 0; night < nights; night += 1)
      await rows(
        `INSERT INTO booking_charges(booking_id,booking_room_id,stay_date,kind,source_key,amount)
         VALUES($1::uuid,$2::uuid,$3::date,'ROOM',$4,$5)`,
        [id, bookingRoom, day(night), `room:${bookingRoom}:${day(night)}`, price],
      );
  }
  return bookingRooms;
}

/** Booking kèm nghĩa vụ ROOM theo phòng–đêm, snapshot giá/policy (ADR-015) và tổng tiền khớp nghĩa vụ. */
export async function booking(input: BookingInput = {}) {
  const status = input.status ?? 'CONFIRMED';
  const checkIn = input.checkIn ?? stay.checkIn;
  const nights = input.nights ?? 3;
  const price = input.price ?? 500_000;
  const rooms = input.rooms ?? [roomId];
  const day = (offset: number) =>
    new Date(Date.parse(`${checkIn}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const policy = await insertPolicy(await flexPolicy());
  const holdExpiry =
    input.holdExpiresAt === undefined
      ? status === 'HELD'
        ? clock.now()
        : null
      : input.holdExpiresAt;
  const id = String(
    (
      await rows(
        `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,
            check_out,adults,deposit_percent,status,hold_expires_at,room_count,total_amount)
         SELECT $1,(SELECT id FROM guests LIMIT 1),$2,(SELECT room_type_id FROM rooms WHERE id=$3::uuid),
            (SELECT id FROM rate_plans WHERE code='FLEX7'),(SELECT id FROM channels WHERE code='WEB'),
            $4,$5,1,30,$6,$7,$8,0
         RETURNING id`,
        [
          `PH-261101-${randomBytes(3).toString('hex').toUpperCase().slice(0, 5)}`,
          propertyId,
          rooms[0],
          checkIn,
          day(nights),
          status,
          holdExpiry,
          rooms.length,
        ],
      )
    )[0]!.id,
  );
  const bookingRooms = await insertRooms(id, rooms, nights, price, day);
  const total = BigInt(price) * BigInt(nights) * BigInt(rooms.length);
  await rows('UPDATE bookings SET total_amount=$2 WHERE id=$1', [id, total.toString()]);
  await insertSnapshot({
    id,
    checkIn,
    checkOut: day(nights),
    nights,
    price,
    total,
    policy,
    bookingRooms: [...bookingRooms.values()],
  });
  return { id, rooms: bookingRooms, total, checkIn, checkOut: day(nights), price: BigInt(price) };
}

/** Thu tiền thật: Payment SUCCEEDED + phân bổ vào nghĩa vụ phòng theo tỷ lệ (như luồng nhận cọc). */
export async function pay(bookingId: string, amount: bigint, type = 'DEPOSIT'): Promise<string> {
  const payment = String(
    (
      await rows(
        `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
         VALUES($1::uuid,$2,'BANK_TRANSFER',$3,'SUCCEEDED',$4,clock_timestamp(),$5::uuid) RETURNING id`,
        [bookingId, type, amount.toString(), randomBytes(16).toString('hex'), userId],
      )
    )[0]!.id,
  );
  const charges = await rows(
    "SELECT id,amount FROM booking_charges WHERE booking_id=$1::uuid AND kind='ROOM' ORDER BY id",
    [bookingId],
  );
  const weights = charges.map((charge) => BigInt(String(charge.amount)));
  const sum = weights.reduce((total, value) => total + value, 0n);
  let left = amount;
  for (const [index, charge] of charges.entries()) {
    const slice = index === charges.length - 1 ? left : (amount * weights[index]!) / sum;
    if (slice <= 0n) continue;
    left -= slice;
    await rows(
      'INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1::uuid,$2::uuid,$3)',
      [payment, String(charge.id), slice.toString()],
    );
  }
  await rows(
    `UPDATE bookings SET paid_amount=(SELECT coalesce(sum(amount),0) FROM payments
        WHERE booking_id=$1::uuid AND status='SUCCEEDED' AND type<>'REFUND' AND type<>'COMPENSATION'),
        deposit_amount=$2::bigint,
        balance_due=greatest(0,(SELECT coalesce(sum(amount-voided_amount),0) FROM booking_charges
          WHERE booking_id=$1::uuid AND kind='ROOM')-$2::bigint)
      WHERE id=$1::uuid`,
    [bookingId, amount.toString()],
  );
  return payment;
}

export async function assign(bookingRoomId: string, room: string, start: string, end: string) {
  return String(
    (
      await rows(
        `INSERT INTO room_assignments(booking_room_id,room_id,bed_no,start_date,end_date)
         VALUES($1::uuid,$2::uuid,0,$3,$4) RETURNING id`,
        [bookingRoomId, room, start, end],
      )
    )[0]!.id,
  );
}
