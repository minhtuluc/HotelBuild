/**
 * Seed + Oracle đọc CSDL cho bộ test khoá OVER (HB-124).
 *
 * Mọi hàm seed đều dựng đúng bất biến CSDL hiện hành (nghĩa vụ `booking_charges` ROOM theo đêm,
 * `Payment` SUCCEEDED đã phân bổ, `price_snapshots` ORIGINAL) để endpoint HB-125 có dữ liệu thật.
 * Hàm `…Row`/`…Of` chỉ đọc trạng thái persisted — test so sánh trước/sau, không tin DTO.
 */
import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import {
  CHECK_IN,
  D,
  NIGHTLY,
  channelId,
  clock,
  day,
  guests,
  insert,
  otherPropertyId,
  propertyId,
  ratePlanId,
  roomTypes,
  rooms,
  rows,
  userIds,
} from './harness.js';

export { D, day, otherPropertyId, rooms, guests, roomTypes, propertyId, CHECK_IN, NIGHTLY };

export interface PaymentSeed {
  readonly amount: number;
  readonly method?: 'CASH' | 'BANK_TRANSFER' | 'VNPAY' | 'MOMO';
}

export interface SeedOptions {
  readonly status?: string;
  readonly checkIn?: string;
  readonly nightlyPrices?: readonly number[];
  readonly spaces?: number;
  readonly roomType?: string;
  readonly property?: string;
  readonly guest?: string;
  readonly assignRoomIds?: readonly (string | null)[];
  readonly beds?: readonly number[];
  readonly paid?: readonly PaymentSeed[];
  readonly priceLocked?: boolean;
  readonly oversold?: boolean;
}

export interface SeededBooking {
  readonly id: string;
  readonly bookingRoomIds: readonly string[];
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nightlyPrices: readonly number[];
  readonly total: number;
}

interface NightLine {
  readonly bookingRoomId: string;
  readonly date: string;
  readonly nightlyPrice: number;
  readonly grossAmount: number;
}

async function insertSnapshot(
  id: string,
  checkIn: string,
  checkOut: string,
  nights: readonly NightLine[],
  total: number,
): Promise<void> {
  const policy = {
    id: 'hb124-policy',
    code: 'FLEX7',
    version: 1,
    tiers: [
      { offsetHours: 168, refundPercent: 100, chargeFirstNight: false },
      { offsetHours: 72, refundPercent: 50, chargeFirstNight: false },
      { offsetHours: 24, refundPercent: 0, chargeFirstNight: false },
      { offsetHours: -1, refundPercent: 0, chargeFirstNight: true },
    ],
  };
  const payload = {
    schemaVersion: 1,
    engineVersion: 'hb124-test',
    ratePlan: { id: ratePlanId.value, code: 'FLEX7', version: 1, depositPercent: 30 },
    policy,
    stay: {
      checkIn,
      checkOut,
      timezone: 'Asia/Ho_Chi_Minh',
      checkInTime: '14:00:00',
      checkOutTime: '12:00:00',
    },
    nights,
    totals: {
      subtotal: total,
      discountAmount: 0,
      grossAmount: total,
      commissionAmount: 0,
      depositAmount: Math.ceil(total * 0.3),
      currency: 'VND',
    },
  };
  await rows(
    `INSERT INTO price_snapshots(booking_id,seq,kind,payload_json,gross_amount,commission_amount,
        policy_snapshot_json,engine_version)
     VALUES($1,1,'ORIGINAL',$2::jsonb,$3,0,$4::jsonb,'hb124-test')`,
    [id, JSON.stringify(payload), total, JSON.stringify(policy)],
  );
}

async function insertPayments(id: string, paid: readonly PaymentSeed[]): Promise<number> {
  const outstanding = new Map<string, number>();
  const amounts = await rows(
    'SELECT id,amount::text AS amount FROM booking_charges WHERE booking_id=$1 ORDER BY source_key',
    [id],
  );
  for (const line of amounts) outstanding.set(String(line.id), Number(line.amount));
  let paidTotal = 0;
  for (const receipt of paid) {
    const payment = await insert(
      `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
       VALUES($1,'DEPOSIT',$2,$3,'SUCCEEDED',$4,clock_timestamp(),$5::uuid) RETURNING id`,
      [
        id,
        receipt.method ?? 'BANK_TRANSFER',
        receipt.amount,
        randomBytes(16).toString('hex'),
        userIds.desk,
      ],
    );
    let left = receipt.amount;
    for (const [charge, amount] of outstanding) {
      if (left <= 0) break;
      const take = Math.min(left, amount);
      if (take <= 0) continue;
      await rows('INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1,$2,$3)', [
        payment,
        charge,
        take,
      ]);
      outstanding.set(charge, amount - take);
      left -= take;
    }
    paidTotal += receipt.amount;
  }
  return paidTotal;
}

interface BookingShape {
  readonly prices: readonly number[];
  readonly spaces: number;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly property: string;
  readonly type: string;
  readonly guest: string;
  readonly status: string;
  readonly oversold: boolean;
  readonly priceLocked: boolean;
}

async function insertBookingRow(shape: BookingShape): Promise<string> {
  const hold =
    shape.status === 'HELD' || shape.status === 'PENDING_PAYMENT'
      ? new Date(clock.value + 3_600_000)
      : null;
  const suffix = randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
  return insert(
    `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,
        check_out,adults,deposit_percent,status,hold_expires_at,oversold,price_locked,room_count)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,30,$9,$10,$11,$12,$13) RETURNING id`,
    [
      `PH-${shape.checkIn.slice(2).replaceAll('-', '')}-${suffix}`,
      shape.guest,
      shape.property,
      shape.type,
      ratePlanId.value,
      channelId.value,
      shape.checkIn,
      shape.checkOut,
      shape.status,
      hold,
      shape.oversold,
      shape.priceLocked,
      shape.spaces,
    ],
  );
}

async function insertDemand(
  id: string,
  shape: BookingShape,
): Promise<{ bookingRoomIds: string[]; nightRows: NightLine[] }> {
  const bookingRoomIds: string[] = [];
  const nightRows: NightLine[] = [];
  for (let space = 0; space < shape.spaces; space += 1) {
    const bookingRoomId = await insert(
      `INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night)
       VALUES($1,$2,1,$3) RETURNING id`,
      [id, shape.type, shape.prices[0] ?? NIGHTLY],
    );
    bookingRoomIds.push(bookingRoomId);
    for (const [index, price] of shape.prices.entries()) {
      const date = day(shape.checkIn, index);
      await insert(
        `INSERT INTO booking_charges(booking_id,booking_room_id,stay_date,kind,source_key,amount)
         VALUES($1,$2,$3,'ROOM',$4,$5) RETURNING id`,
        [id, bookingRoomId, date, `room:${bookingRoomId}:${date}`, price],
      );
      nightRows.push({ bookingRoomId, date, nightlyPrice: price, grossAmount: price });
    }
  }
  return { bookingRoomIds, nightRows };
}

async function insertAssignments(
  bookingRoomIds: readonly string[],
  shape: BookingShape,
  options: SeedOptions,
): Promise<void> {
  for (const [index, room] of (options.assignRoomIds ?? []).entries()) {
    const bookingRoomId = bookingRoomIds[index];
    if (bookingRoomId === undefined || room === null) continue;
    await rows(
      `INSERT INTO room_assignments(booking_room_id,room_id,bed_no,start_date,end_date)
       VALUES($1,$2,$3,$4,$5)`,
      [bookingRoomId, room, options.beds?.[index] ?? 0, shape.checkIn, shape.checkOut],
    );
  }
}

function valueOr<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

/** Booking kèm nghĩa vụ ROOM từng đêm, snapshot ORIGINAL và các khoản thu đã phân bổ. */
export async function seedBooking(options: SeedOptions = {}): Promise<SeededBooking> {
  const nightlyPrices = valueOr(options.nightlyPrices, [NIGHTLY]);
  const checkIn = valueOr(options.checkIn, CHECK_IN);
  const properties = {
    prices: nightlyPrices,
    spaces: valueOr(options.spaces, 1),
    checkIn,
    checkOut: day(checkIn, nightlyPrices.length),
    property: valueOr(options.property, propertyId),
    type: valueOr(options.roomType, roomTypes.std),
    guest: valueOr(options.guest, guests.male),
    status: valueOr(options.status, 'CONFIRMED'),
    oversold: valueOr(options.oversold, false),
    priceLocked: valueOr(options.priceLocked, true),
  };
  const total = nightlyPrices.reduce((sum, price) => sum + price, 0) * properties.spaces;
  const id = await insertBookingRow(properties);
  const { bookingRoomIds, nightRows } = await insertDemand(id, properties);
  const paidTotal = await insertPayments(id, valueOr(options.paid, []));
  await rows(
    `UPDATE bookings SET total_amount=$2,paid_amount=$3,balance_due=greatest(0,$2::bigint-$3::bigint)
     WHERE id=$1`,
    [id, total, paidTotal],
  );
  await insertAssignments(bookingRoomIds, properties, options);
  await insertSnapshot(id, properties.checkIn, properties.checkOut, nightRows, total);
  const stored = await rows('SELECT total_amount::text AS total FROM bookings WHERE id=$1', [id]);
  expect(stored).toEqual([{ total: String(total) }]);
  return {
    id,
    bookingRoomIds,
    checkIn: properties.checkIn,
    checkOut: properties.checkOut,
    nightlyPrices,
    total,
  };
}

export interface CaseOptions {
  readonly date?: string;
  readonly shortage?: number;
  readonly status?: string;
  readonly detectedAt?: Date;
  readonly escalatedAt?: Date | null;
  readonly delayReason?: string | null;
  readonly roomType?: string;
  readonly property?: string;
}

export async function seedCase(options: CaseOptions = {}): Promise<string> {
  const status = valueOr(options.status, 'OPEN');
  const escalated = valueOr(options.escalatedAt, status === 'ESCALATED' ? new Date() : null);
  return insert(
    `INSERT INTO overbooking_cases(property_id,date,room_type_id,shortage_count,status,detected_at,
        escalated_at,delay_reason)
     VALUES($1,$2,$3,$4,$5,coalesce($6,now()),$7,$8) RETURNING id`,
    [
      valueOr(options.property, propertyId),
      valueOr(options.date, CHECK_IN),
      valueOr(options.roomType, roomTypes.std),
      valueOr(options.shortage, 1),
      status,
      valueOr(options.detectedAt, null),
      escalated,
      valueOr(options.delayReason, null),
    ],
  );
}

export const bookingRow = async (id: string) => {
  const found = await rows(
    `SELECT status,paid_amount::text AS paid_amount,refunded_amount::text AS refunded_amount,
            penalty_amount::text AS penalty_amount,cancel_reason,price_locked,version
       FROM bookings WHERE id=$1`,
    [id],
  );
  expect(found).toHaveLength(1);
  return found[0]!;
};

export const moveRow = async (id: string) => {
  const found = await rows('SELECT * FROM room_moves WHERE id=$1', [id]);
  expect(found).toHaveLength(1);
  return found[0]!;
};

export const mergeRow = async (id: string) => {
  const found = await rows('SELECT * FROM room_merges WHERE id=$1', [id]);
  expect(found).toHaveLength(1);
  return found[0]!;
};

export const refundRows = (bookingId: string) =>
  rows('SELECT * FROM refund_requests WHERE booking_id=$1 ORDER BY created_at', [bookingId]);

export const chargeTotal = async (bookingId: string): Promise<number> => {
  const [row] = await rows(
    `SELECT coalesce(sum(amount-voided_amount),0)::text AS total FROM booking_charges
      WHERE booking_id=$1 AND kind='ROOM'`,
    [bookingId],
  );
  return Number(row?.total ?? 0);
};

export const snapshotGross = async (bookingId: string): Promise<number> => {
  const [row] = await rows(
    "SELECT gross_amount::text AS gross FROM price_snapshots WHERE booking_id=$1 AND kind='ORIGINAL'",
    [bookingId],
  );
  return Number(row?.gross ?? 0);
};

export const paymentRows = (bookingId: string) =>
  rows(
    `SELECT id,type,method,amount::text AS amount,status FROM payments
      WHERE booking_id=$1 ORDER BY created_at,id`,
    [bookingId],
  );

/** Chỉ dùng SAU `guardRoute`: cột `room_move_id` do HB-121 bổ sung. */
export const compensationPayments = (roomMoveId: string) =>
  rows(
    `SELECT id,type,method,amount::text AS amount,status,room_move_id
       FROM payments WHERE room_move_id=$1 ORDER BY created_at`,
    [roomMoveId],
  );

export const activeAssignments = (bookingRoomId: string) =>
  rows(
    `SELECT room_id,bed_no,released_at FROM room_assignments
      WHERE booking_room_id=$1 AND released_at IS NULL ORDER BY room_id,bed_no`,
    [bookingRoomId],
  );

export const assignmentsOnRoom = (roomId: string) =>
  rows(
    `SELECT booking_room_id,bed_no FROM room_assignments
      WHERE room_id=$1 AND released_at IS NULL ORDER BY bed_no`,
    [roomId],
  );

export const countRows = async (sql: string, values: unknown[] = []): Promise<number> => {
  const [row] = await rows(`SELECT count(*)::int AS total FROM (${sql}) t`, values);
  return Number(row?.total ?? 0);
};
