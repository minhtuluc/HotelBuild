import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Fixture HB-147 (job `q.no-show-mark`): dựng một booking `CONFIRMED` tối thiểu trên PostgreSQL16 thật —
 * `properties` → `room_types` → `rooms` → `bookings` → `booking_rooms` + `booking_charges` +
 * `price_snapshots` + `room_assignments`, kèm `Payment` DEPOSIT SUCCEEDED khi cần.
 *
 * Mọi mốc ngày/giờ lấy từ **giờ CSDL** (`clock_timestamp()`), không từ đồng hồ tiến trình: đó chính là
 * điều job phải làm (BR-BOOK-18).
 */
export const TZ = 'Asia/Ho_Chi_Minh';

/** Ngày nghiệp vụ VN "hôm nay" theo **giờ CSDL** — mốc so sánh của job. */
export async function businessDate(db: PrismaClient, offsetDays = 0): Promise<string> {
  const rows = await db.$queryRaw<{ date: string }[]>`
    SELECT (((clock_timestamp() AT TIME ZONE ${TZ})::date + ${offsetDays}::int))::text AS date`;
  return rows[0]!.date;
}

/** Giờ VN hiện tại theo giờ CSDL, dạng `HH24:MI:SS` — dùng để chọn mốc đã/chưa tới. */
export async function businessClock(db: PrismaClient): Promise<string> {
  const rows = await db.$queryRaw<{ time: string }[]>`
    SELECT to_char(clock_timestamp() AT TIME ZONE ${TZ}, 'HH24:MI:SS') AS time`;
  return rows[0]!.time;
}

export interface SeedNoShowInput {
  readonly label: string;
  /** Lệch ngày nhận phòng so với ngày nghiệp vụ hôm nay (0 = hôm nay, 1 = mai, -1 = hôm qua). */
  readonly checkInOffsetDays?: number;
  readonly status?: string;
  readonly units?: number;
  /** Tiền phòng mỗi đêm của mỗi đơn vị bán (VND nguyên). */
  readonly nightly?: number;
  /** Số đêm. */
  readonly nights?: number;
  /** Tổng tiền đã thu (`Payment` DEPOSIT SUCCEEDED + phân bổ vào nghĩa vụ ROOM). */
  readonly paid?: number;
  /** Bậc bắt tất có phạt đêm đầu hay không (BR-CANCEL-06). */
  readonly chargeFirstNight?: boolean;
  /** Gán phòng ngay (mặc định có) — no-show phải nhả phân công. */
  readonly assign?: boolean;
}

export interface NoShowFixture {
  readonly bookingId: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly bookingRoomIds: readonly string[];
  readonly roomIds: readonly string[];
  readonly checkIn: string;
  readonly checkOut: string;
  readonly firstNight: bigint;
}

export function onlyRow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`fixture HB-147: không dựng được ${what}`);
  return row;
}

let guestSequence = 700_000_000;

interface ReferenceRows {
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly roomIds: readonly string[];
  readonly channelId: string;
  readonly policyId: string;
  readonly ratePlanId: string;
  readonly guestId: string;
}

/** Bảng tham chiếu dùng chung trong một CSDL test (mỗi fixture một cơ sở/phòng riêng). */
async function seedReference(
  db: PrismaClient,
  label: string,
  nightly: number,
  units: number,
): Promise<ReferenceRows> {
  const property = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO properties(code, name, address, phone, latitude, longitude)
      VALUES (${`H147-${label}`}, ${`Cơ sở test ${label}`}, 'Địa chỉ test',
              '+84900000000', 10.776900, 106.700900)
      RETURNING id`,
    'cơ sở test',
  );
  const roomType = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO room_types(property_id, code, name, capacity_adults, base_price, min_price, max_price)
      VALUES (${property.id}::uuid, 'STD', 'Standard test', 2, ${nightly}, 400000, 3000000)
      RETURNING id`,
    'loại phòng test',
  );
  const roomIds: string[] = [];
  for (let index = 0; index < units; index += 1) {
    const room = onlyRow(
      await db.$queryRaw<{ id: string }[]>`
        INSERT INTO rooms(property_id, room_type_id, code, name)
        VALUES (${property.id}::uuid, ${roomType.id}::uuid, ${`${label}-R${index + 1}`},
                ${`Phòng ${index + 1}`})
        RETURNING id`,
      `phòng ${index + 1}`,
    );
    roomIds.push(room.id);
  }
  const channel = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO channels(code, name, multiplier, hold_minutes)
      VALUES ('WEB', 'Kênh WEB', 1.000, 20)
      ON CONFLICT (code) DO UPDATE SET name = excluded.name
      RETURNING id`,
    'kênh WEB',
  );
  const policy = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO cancellation_policies(code, name)
      VALUES ('HB147-POLICY', 'Chính sách test HB-147')
      ON CONFLICT (code) DO UPDATE SET name = excluded.name
      RETURNING id`,
    'chính sách huỷ test',
  );
  const ratePlan = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO rate_plans(code, name, deposit_percent, cancellation_policy_id)
      VALUES ('FLEX7', 'FLEX7 test', 30, ${policy.id}::uuid)
      ON CONFLICT (code) DO UPDATE SET name = excluded.name
      RETURNING id`,
    'gói giá test',
  );
  guestSequence += 1;
  const guest = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO guests(full_name, phone) VALUES (${`Khách ${label}`}, ${`+84${guestSequence}`})
      RETURNING id`,
    'khách test',
  );
  return {
    propertyId: property.id,
    roomTypeId: roomType.id,
    roomIds,
    channelId: channel.id,
    policyId: policy.id,
    ratePlanId: ratePlan.id,
    guestId: guest.id,
  };
}

interface SeedUnitInput {
  readonly bookingId: string;
  readonly roomTypeId: string;
  readonly roomId: string;
  readonly nightly: number;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly assign: boolean;
  readonly label: string;
}

/** Một đơn vị bán: `booking_rooms` + phân công (tuỳ chọn) + nghĩa vụ ROOM từng đêm. */
async function seedUnit(db: PrismaClient, input: SeedUnitInput): Promise<string> {
  const bookingRoom = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO booking_rooms(booking_id, room_type_id, adults, price_per_night)
      VALUES (${input.bookingId}::uuid, ${input.roomTypeId}::uuid, 1, ${input.nightly})
      RETURNING id`,
    `đơn vị bán ${input.label}`,
  );
  if (input.assign)
    await db.$executeRaw`
      INSERT INTO room_assignments(booking_room_id, room_id, start_date, end_date)
      VALUES (${bookingRoom.id}::uuid, ${input.roomId}::uuid, ${input.checkIn}::date,
              ${input.checkOut}::date)`;
  await db.$executeRaw`
    INSERT INTO booking_charges(booking_id, booking_room_id, stay_date, kind, source_key, amount)
    SELECT ${input.bookingId}::uuid, ${bookingRoom.id}::uuid, day::date, 'ROOM',
           ${`ROOM:${bookingRoom.id}:`} || day::date::text, ${input.nightly}
      FROM generate_series(${input.checkIn}::date, ${input.checkOut}::date - 1, '1 day') day`;
  return bookingRoom.id;
}

/** `Payment` DEPOSIT SUCCEEDED + phân bổ tuần tự theo đêm (như đường thu tiền tại quầy HB-096). */
async function seedDeposit(
  db: PrismaClient,
  bookingId: string,
  paid: number,
  total: bigint,
): Promise<void> {
  const payment = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO payments(booking_id, type, method, amount, status, idempotency_key, paid_at)
      VALUES (${bookingId}::uuid, 'DEPOSIT', 'BANK_TRANSFER', ${paid}, 'SUCCEEDED',
              ${`seed-deposit:${bookingId}`}, clock_timestamp())
      RETURNING id`,
    'payment test',
  );
  await db.$executeRaw`
    WITH plan AS (
      SELECT c.id, least(${paid}::bigint - coalesce(sum(c.amount) OVER (
               ORDER BY c.stay_date, c.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0),
             c.amount) AS amount
        FROM booking_charges c
       WHERE c.booking_id = ${bookingId}::uuid AND c.kind = 'ROOM'
    )
    INSERT INTO payment_allocations(payment_id, charge_id, amount)
    SELECT ${payment.id}::uuid, plan.id, plan.amount FROM plan WHERE plan.amount > 0`;
  await db.$executeRaw`
    UPDATE bookings SET paid_amount = ${paid}, balance_due = ${total - BigInt(paid)}
     WHERE id = ${bookingId}::uuid`;
}

/** Snapshot ORIGINAL với ba bậc; bậc bắt tất `-1` quyết định phạt đêm đầu (BR-CANCEL-06/10). */
async function seedSnapshot(
  db: PrismaClient,
  input: {
    bookingId: string;
    checkIn: string;
    checkOut: string;
    nightly: number;
    nights: number;
    units: number;
    policyId: string;
    chargeFirstNight: boolean;
  },
): Promise<void> {
  const gross = input.nightly * input.nights * input.units;
  await db.$executeRaw`
    INSERT INTO price_snapshots(booking_id, seq, kind, payload_json, gross_amount,
                                commission_amount, policy_snapshot_json, engine_version)
    VALUES (${input.bookingId}::uuid, 1, 'ORIGINAL',
            ${JSON.stringify({
              schemaVersion: 1,
              stay: { checkIn: input.checkIn, checkOut: input.checkOut, timezone: TZ },
              nights: [],
              totals: { grossAmount: gross, currency: 'VND' },
            })}::jsonb,
            ${BigInt(gross)}, 0,
            ${JSON.stringify({
              id: input.policyId,
              code: 'HB147-POLICY',
              name: 'Chính sách test HB-147',
              tiers: [
                { id: 't1', offsetHours: 168, refundPercent: 100, chargeFirstNight: false },
                { id: 't2', offsetHours: 72, refundPercent: 50, chargeFirstNight: false },
                {
                  id: 't4',
                  offsetHours: -1,
                  refundPercent: 0,
                  chargeFirstNight: input.chargeFirstNight,
                },
              ],
            })}::jsonb,
            'hb147-test')`;
}

export async function seedNoShow(db: PrismaClient, input: SeedNoShowInput): Promise<NoShowFixture> {
  const units = input.units ?? 1;
  const nightly = input.nightly ?? 1_100_000;
  const nights = input.nights ?? 2;
  const offset = input.checkInOffsetDays ?? 0;
  const status = input.status ?? 'CONFIRMED';
  const paid = input.paid ?? 0;
  const total = BigInt(nightly) * BigInt(nights) * BigInt(units);
  const ref = await seedReference(db, input.label, nightly, units);
  const booking = onlyRow(
    await db.$queryRaw<{ id: string; check_in: string; check_out: string }[]>`
      WITH dates AS (
        SELECT ((clock_timestamp() AT TIME ZONE ${TZ})::date + ${offset}::int) AS check_in
      ), booking AS (
        INSERT INTO bookings(code, guest_id, property_id, room_type_id, rate_plan_id, channel_id,
                             check_in, check_out, adults, children, status, room_count, total_amount,
                             deposit_percent, deposit_amount, balance_due)
        SELECT ${`PH-260101-${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`},
               ${ref.guestId}::uuid, ${ref.propertyId}::uuid, ${ref.roomTypeId}::uuid,
               ${ref.ratePlanId}::uuid, ${ref.channelId}::uuid, dates.check_in,
               dates.check_in + ${nights}::int, 1, 0, ${status}, ${units}, ${total}, 30,
               ${BigInt(Math.ceil(nightly * nights * units * 0.3))}, ${total}
          FROM dates
        RETURNING id, check_in, check_out
      )
      SELECT id, check_in::text AS check_in, check_out::text AS check_out FROM booking`,
    'booking test',
  );
  const bookingRoomIds: string[] = [];
  for (const [index, roomId] of ref.roomIds.entries())
    bookingRoomIds.push(
      await seedUnit(db, {
        bookingId: booking.id,
        roomTypeId: ref.roomTypeId,
        roomId,
        nightly,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        assign: input.assign !== false,
        label: `${input.label}-${index + 1}`,
      }),
    );
  if (paid > 0) await seedDeposit(db, booking.id, paid, total);
  await seedSnapshot(db, {
    bookingId: booking.id,
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    nightly,
    nights,
    units,
    policyId: ref.policyId,
    chargeFirstNight: input.chargeFirstNight ?? true,
  });
  return {
    bookingId: booking.id,
    propertyId: ref.propertyId,
    roomTypeId: ref.roomTypeId,
    bookingRoomIds,
    roomIds: ref.roomIds,
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    firstNight: BigInt(nightly) * BigInt(units),
  };
}
