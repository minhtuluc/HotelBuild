/**
 * Fixture HB-144 — app thật (`AppModule.register`) trên CSDL tách riêng của
 * `test/idempotency/database.js` (migrate sạch) + PostgreSQL16 + Redis7 (`/11`), clock giả điều khiển
 * mốc giờ nghiệp vụ như harness F1/F7.
 *
 * Chỉ dựng đúng dữ kiện check-in đọc: booking CONFIRMED, nghĩa vụ ROOM từng đêm + Payment SUCCEEDED đã
 * phân bổ (để sổ cái HB-093 tính `balanceDue`), phòng vật lý và nhiệm vụ buồng phòng của ngày nghiệp vụ.
 * Server quyết mọi luật; fixture không tự tính tiền/ngưỡng (tránh nguồn sự thật thứ hai).
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import request from 'supertest';
import { tokenPairSchema } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { clock, databaseUrl, password, propertyId, rows, userId } from '../idempotency/database.js';

let app: NestFastifyApplication;
let redis: Redis;
let policyId = '',
  ratePlanId = '',
  channelId = '',
  typeId = '',
  dormTypeId = '',
  guestId = '',
  roomOne = '',
  roomTwo = '',
  dormRoom = '',
  roomThree = '';

export { clock, rows, userId };
export const CHECK_IN = '/api/v1/front-office/check-in';
/** Ngày nghiệp vụ ghim; giờ VN không có DST nên cộng/trừ ngày bằng UTC là đúng. */
export const D = '2026-11-10';
export const NIGHTLY = 1_100_000;
const DAY = 86_400_000;

export const http = () => request(app.getHttpServer());
export const day = (date: string, offset: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
export const vn = (date: string, time: string) => Date.parse(`${date}T${time}+07:00`);

/** Mã lỗi của body lỗi hợp đồng; `undefined` khi phản hồi không mang mã lỗi. */
export function errorCode(response: { body: unknown }): string | undefined {
  const body: unknown = response.body;
  if (typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string')
    return body.code;
  return undefined;
}

const insert = async (sql: string, values: unknown[] = []): Promise<string> =>
  String((await rows(sql, values))[0]!.id);

/** Phiên nhân viên thật; đổi vai trò trước khi đăng nhập để `RbacGuard` đọc lại từ CSDL. */
export async function staffToken(role: string): Promise<string> {
  await rows('UPDATE users SET role=$1,is_active=true WHERE id=$2', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

export const post = (path: string, token: string, body: object, key = randomUUID()) =>
  http().post(path).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send(body);

/** Nhiệm vụ buồng phòng của lượt giải phóng hiện tại (BR-FO-06/07). */
export async function housekeeping(
  roomId: string,
  businessDate = D,
  status = 'DONE',
): Promise<string> {
  return insert(
    `INSERT INTO housekeeping_tasks(room_id,business_date,status,completed_at)
     VALUES($1,$2,$3,CASE WHEN $3 IN ('DONE','INSPECTED') THEN clock_timestamp() END) RETURNING id`,
    [roomId, businessDate, status],
  );
}

export const roomA = (): string => roomOne;
export const roomB = (): string => roomTwo;
export const roomC = (): string => roomThree;
/** Phòng ở ghép (DOR) — check-in theo giường chưa thuộc hợp đồng `actualRoomIds`. */
export const roomDorm = (): string => dormRoom;
export const dormType = (): string => dormTypeId;
export const guestOf = (): string => guestId;

export interface BookingOptions {
  status?: string;
  checkIn?: string;
  checkOut?: string;
  nightly?: number;
  /** Số tiền phòng đã thu (một Payment SUCCEEDED + phân bổ vào nghĩa vụ ROOM). */
  paid?: number;
  paidInFull?: boolean;
  /** Gán phòng ngay khi seed — mô phỏng assignment đã có từ hold (F4). */
  assign?: string;
  /** Loại phòng của booking; mặc định loại bán theo phòng. */
  roomTypeId?: string;
  /** Số đơn vị bán (`booking_rooms`); mặc định 1. Với >1 chỉ hỗ trợ `paidInFull` hoặc chưa thu. */
  units?: number;
  /**
   * Phòng gán sẵn cho từng đơn vị bán theo thứ tự `booking_rooms.id` tăng dần; `null` = chưa gán.
   * Ghi đè `assign` (chỉ đơn vị đầu).
   */
  assignEach?: readonly (string | null)[];
}

export interface SeededBooking {
  readonly id: string;
  /** Đơn vị bán có `id` nhỏ nhất. */
  readonly bookingRoomId: string;
  /** Mọi đơn vị bán, sắp theo `id` tăng dần (thứ tự mã cũ dùng để ghép `actualRoomIds`). */
  readonly bookingRoomIds: readonly string[];
  readonly checkIn: string;
  readonly checkOut: string;
  readonly total: number;
}
const ROOM_CHARGE = `INSERT INTO booking_charges(booking_id,booking_room_id,stay_date,kind,source_key,amount)
  VALUES($1,$2,$3,'ROOM',$4,$5) RETURNING id`;
const PAYMENT = `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
  VALUES($1,'DEPOSIT','BANK_TRANSFER',$2,'SUCCEEDED',$3,clock_timestamp(),$4) RETURNING id`;

/** Nghĩa vụ ROOM từng đêm + Payment SUCCEEDED đã phân bổ (BR-PAY-02). */
async function insertLedger(
  bookingId: string,
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
        bookingId,
        bookingRoomId,
        stayDate,
        `room:${bookingRoomId}:${stayDate}`,
        nightly,
      ]),
    );
  }
  if (paid <= 0) return;
  const payment = await insert(PAYMENT, [bookingId, paid, randomUUID(), userId]);
  let left = paid;
  for (const charge of charges) {
    if (left <= 0) break;
    const amount = Math.min(left, nightly);
    await rows('INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1,$2,$3)', [
      payment,
      charge,
      amount,
    ]);
    left -= amount;
  }
}

/** `units` đơn vị bán của booking, sắp theo `id` tăng dần (thứ tự mã cũ dùng để ghép `actualRoomIds`). */
async function insertUnits(
  bookingId: string,
  roomType: string,
  nightly: number,
  units: number,
): Promise<string[]> {
  const created: string[] = [];
  for (let unit = 0; unit < units; unit += 1)
    created.push(
      await insert(
        'INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night) VALUES($1,$2,1,$3) RETURNING id',
        [bookingId, roomType, nightly],
      ),
    );
  return created.sort();
}

/** Gán sẵn phòng cho từng đơn vị (mô phỏng assignment đã có từ hold). */
async function assignUnits(
  bookingRoomIds: readonly string[],
  options: BookingOptions,
  checkIn: string,
  checkOut: string,
): Promise<void> {
  const assigned = options.assignEach ?? (options.assign === undefined ? [] : [options.assign]);
  for (const [index, roomId] of assigned.entries()) {
    const bookingRoomId = bookingRoomIds[index];
    if (roomId === null || bookingRoomId === undefined) continue;
    await rows(
      'INSERT INTO room_assignments(booking_room_id,room_id,bed_no,start_date,end_date) VALUES($1,$2,0,$3,$4)',
      [bookingRoomId, roomId, checkIn, checkOut],
    );
  }
}

/** Booking CONFIRMED + nghĩa vụ ROOM từng đêm + (tuỳ chọn) Payment đã phân bổ. */
function resolveBooking(options: BookingOptions) {
  const checkIn = options.checkIn ?? D;
  const checkOut = options.checkOut ?? day(checkIn, 2);
  const nightly = options.nightly ?? NIGHTLY;
  const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY);
  const units = options.units ?? 1;
  const total = nightly * nights * units;
  return {
    status: options.status ?? 'CONFIRMED',
    checkIn,
    checkOut,
    nightly,
    nights,
    units,
    total,
    paid: options.paidInFull === true ? total : (options.paid ?? 0),
    roomType: options.roomTypeId ?? typeId,
  };
}

export async function seedBooking(options: BookingOptions = {}): Promise<SeededBooking> {
  const { status, checkIn, checkOut, nightly, nights, units, total, paid, roomType } =
    resolveBooking(options);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase();
  const id = await insert(
    `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,
        check_in,check_out,adults,deposit_percent,status,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,30,$9,$10) RETURNING id`,
    [
      `PH-${checkIn.slice(2).replaceAll('-', '')}-${suffix}`,
      guestId,
      propertyId,
      roomType,
      ratePlanId,
      channelId,
      checkIn,
      checkOut,
      status,
      userId,
    ],
  );
  const bookingRoomIds = await insertUnits(id, roomType, nightly, units);
  // Một Payment bao toàn bộ khoản đã thu cho đơn vị duy nhất; booking nhiều đơn vị chỉ thu đủ hoặc chưa
  // thu. Fixture không phân bổ tiền theo nghĩa vụ mà server quyết.
  const paidPerUnit = units === 1 ? paid : options.paidInFull === true ? nightly * nights : 0;
  for (const bookingRoomId of bookingRoomIds)
    await insertLedger(id, bookingRoomId, checkIn, nightly, nights, paidPerUnit);
  await rows('UPDATE bookings SET total_amount=$2,paid_amount=$3,balance_due=$4 WHERE id=$1', [
    id,
    total,
    paid,
    total - paid,
  ]);
  await assignUnits(bookingRoomIds, options, checkIn, checkOut);
  return { id, bookingRoomId: bookingRoomIds[0]!, bookingRoomIds, checkIn, checkOut, total };
}

export const checkInBody = (seed: SeededBooking, roomId: string, extra: object = {}) => ({
  bookingId: seed.id,
  actualRoomIds: [roomId],
  earlyCheckIn: false,
  ...extra,
});

/** Thân nhận phòng nhiều đơn vị: `actualRoomIds` đúng thứ tự người gọi chọn. */
export const checkInBodyMany = (seed: SeededBooking, roomIds: readonly string[]) => ({
  bookingId: seed.id,
  actualRoomIds: [...roomIds],
  earlyCheckIn: false,
});

/** Nhả assignment của một lượt ở đã diễn ra (mô phỏng trả phòng) vào đúng mốc giờ nghiệp vụ. */
export async function releaseStay(
  bookingRoomId: string,
  date: string,
  time = '11:00:00',
  reason = 'CHECK_OUT',
): Promise<void> {
  await rows(
    'UPDATE room_assignments SET released_at=$2, release_reason=$3 WHERE booking_room_id=$1 AND released_at IS NULL',
    [bookingRoomId, new Date(vn(date, time)).toISOString(), reason],
  );
}

/** Phòng gán đang hiệu lực của từng đơn vị bán (theo thứ tự `booking_rooms.id`). */
export async function activeRoomByUnit(seed: SeededBooking): Promise<(string | undefined)[]> {
  const found = await rows(
    `SELECT booking_room_id, room_id FROM room_assignments
      WHERE booking_room_id = ANY($1::uuid[]) AND released_at IS NULL`,
    [[...seed.bookingRoomIds]],
  );
  const byUnit = new Map(found.map((row) => [String(row.booking_room_id), String(row.room_id)]));
  return seed.bookingRoomIds.map((unit) => byUnit.get(unit));
}

export const bookingRow = async (id: string) => {
  const found = await rows('SELECT status,balance_due FROM bookings WHERE id=$1', [id]);
  expect(found).toHaveLength(1);
  return found[0]!;
};
export const activeAssignments = (bookingRoomId: string) =>
  rows(
    `SELECT room_id,bed_no,start_date::text AS start_date,end_date::text AS end_date
       FROM room_assignments WHERE booking_room_id=$1 AND released_at IS NULL ORDER BY created_at`,
    [bookingRoomId],
  );
export const allAssignments = (bookingRoomId: string) =>
  rows(
    `SELECT room_id,released_at,release_reason
       FROM room_assignments WHERE booking_room_id=$1 ORDER BY created_at`,
    [bookingRoomId],
  );
export const auditPayloads = (bookingId: string) =>
  rows(
    `SELECT actor_id,reason,action,
            concat(coalesce(before_json::text,''),coalesce(after_json::text,'')) AS payload
       FROM audit_logs WHERE entity_type='Booking' AND entity_id=$1 ORDER BY chain_seq`,
    [bookingId],
  );
export const historyRows = (bookingId: string, toStatus: string) =>
  rows('SELECT at::text AS at FROM booking_status_history WHERE booking_id=$1 AND to_status=$2', [
    bookingId,
    toStatus,
  ]);
export const extraCharges = (bookingId: string) =>
  rows(
    `SELECT kind,amount::text AS amount,source_key FROM booking_charges
      WHERE booking_id=$1 AND kind='EXTRA_SERVICE' ORDER BY created_at`,
    [bookingId],
  );
export const guestIdNumber = async (id: string): Promise<string | null> => {
  const value = (await rows('SELECT id_number FROM guests WHERE id=$1', [id]))[0]!.id_number;
  return typeof value === 'string' ? value : null;
};

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-144 requires PG16 + Redis7; no skip fallback');
  policyId = await insert(
    "INSERT INTO cancellation_policies(code,name) VALUES('UC144','Synthetic UC-144') RETURNING id",
  );
  await rows(
    `INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order)
     VALUES($1,24,50,false,'>=24h',1),($1,-1,0,true,'<24h',2)`,
    [policyId],
  );
  ratePlanId = await insert(
    `INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id)
     VALUES('FLEX7','Synthetic UC144',30,$1) RETURNING id`,
    [policyId],
  );
  channelId = await insert(
    "INSERT INTO channels(code,name,multiplier) VALUES('WEB','Web',1) RETURNING id",
  );
  typeId = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price)
     VALUES($1,'STD','Synthetic UC144',2,$2,400000,3000000) RETURNING id`,
    [propertyId, NIGHTLY],
  );
  dormTypeId = await insert(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price,allow_shared)
     VALUES($1,'DOR','Synthetic DOR',2,$2,400000,3000000,true) RETURNING id`,
    [propertyId, NIGHTLY],
  );
  guestId = await insert(
    "INSERT INTO guests(full_name,phone) VALUES('Synthetic UC-144','+84900000144') RETURNING id",
  );
  roomOne = await insert(
    `INSERT INTO rooms(property_id,room_type_id,code,name,floor,bed_count)
     VALUES($1,$2,'UCR1','UCR1',1,1) RETURNING id`,
    [propertyId, typeId],
  );
  roomTwo = await insert(
    `INSERT INTO rooms(property_id,room_type_id,code,name,floor,bed_count)
     VALUES($1,$2,'UCR2','UCR2',1,1) RETURNING id`,
    [propertyId, typeId],
  );
  roomThree = await insert(
    `INSERT INTO rooms(property_id,room_type_id,code,name,floor,bed_count)
     VALUES($1,$2,'UCR3','UCR3',1,1) RETURNING id`,
    [propertyId, typeId],
  );
  dormRoom = await insert(
    `INSERT INTO rooms(property_id,room_type_id,code,name,floor,bed_count)
     VALUES($1,$2,'UCD1','UCD1',1,6) RETURNING id`,
    [propertyId, dormTypeId],
  );

  const redisUrl = new URL(process.env.REDIS_URL);
  // `/11` mặc định; lát cắt đang chạy song song đặt `REDIS_URL` với DB riêng thì dùng DB đó để không
  // `flushdb` lên nhau (Redis dev chỉ có DB 0–15).
  if (redisUrl.pathname === '/' || redisUrl.pathname === '/0') redisUrl.pathname = '/11';
  redis = new Redis(redisUrl.href);
  await redis.ping();
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
}, 90000);

beforeEach(async () => {
  clock.value = vn(D, '10:00:00');
  await redis.flushdb();
  await rows('TRUNCATE bookings CASCADE');
  await rows('DELETE FROM housekeeping_tasks');
  await rows('DELETE FROM room_blocks');
  await rows('DELETE FROM idempotency_keys');
  await rows("UPDATE rooms SET status='ACTIVE'");
  await rows('UPDATE guests SET id_number=NULL WHERE id=$1', [guestId]);
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);
