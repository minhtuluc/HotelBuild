/**
 * Dữ liệu seed của HB-097: booking + nghĩa vụ phòng–đêm, snapshot giá/policy (csdl §3.6),
 * thu tiền thật và assignment. Tách khỏi `fixture.ts` (app/HTTP) cho vừa hạn mức tệp của lint.
 */
import { randomBytes } from 'node:crypto';
import { rows, roomId, userId, propertyId, clock, stay } from '../room-blocks/inventory-seed.js';
import { planReceiptAllocation } from '../../src/modules/pay/ledger/receipt-allocation.js';

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
  /** Kênh bán: `WEB`/`WALKIN`… hoặc `OTA_AGODA` cho luồng BR-CHAN-04. */
  channel?: string;
  /** Mã chính sách kênh (`bookings.channel_policy_code`) — dấu hiệu booking đến từ OTA. */
  channelPolicyCode?: string | null;
  /** Giảm giá mỗi đêm (khác 0 ⇒ `nightlyPrice` > `grossAmount` để kiểm tổng `subtotal`/`discountAmount`). */
  discount?: number;
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

/**
 * Một dòng `nights[]` theo đủ trường đã chốt (csdl §3.6): giá cơ bản, hệ số, nguồn/version giá,
 * `grossAmount` sau giảm, hoa hồng từng đêm. Bản sao PARTIAL_CANCEL phải giữ **nguyên vẹn** các trường này.
 */
function nightOf(bookingRoomId: string, date: string, price: number, discount: number) {
  const grossAmount = price - discount;
  return {
    bookingRoomId,
    date,
    basePrice: price,
    nightlyPrice: price,
    grossAmount,
    commissionPct: COMMISSION_PCT,
    commissionAmount: Math.floor((grossAmount * COMMISSION_PCT) / 100),
    source: { type: 'ROOM_TYPE', id: null, version: 1 },
    multipliers: { weekend: 1, season: 1, los: 1, channel: 1 },
    channelPropertySettingId: null,
    channelPropertySettingVersion: null,
    channelVersion: 1,
  };
}

/** `price_snapshots` ORIGINAL theo csdl §3.6: tổng = tổng các đêm (khớp hai cột gross/commission). */
async function insertSnapshot(input: {
  id: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  price: number;
  discount: number;
  total: bigint;
  policy: PolicySnapshot;
  bookingRooms: readonly string[];
}) {
  const day = (offset: number) =>
    new Date(Date.parse(`${input.checkIn}T00:00:00Z`) + offset * 86_400_000)
      .toISOString()
      .slice(0, 10);
  const nights = input.bookingRooms.flatMap((bookingRoom) =>
    Array.from({ length: input.nights }, (_unused, night) =>
      nightOf(bookingRoom, day(night), input.price, input.discount),
    ),
  );
  const subtotal = nights.reduce((sum, night) => sum + night.nightlyPrice, 0);
  const discountAmount = nights.reduce(
    (sum, night) => sum + (night.nightlyPrice - night.grossAmount),
    0,
  );
  const grossAmount = nights.reduce((sum, night) => sum + night.grossAmount, 0);
  const commissionAmount = nights.reduce((sum, night) => sum + night.commissionAmount, 0);
  await rows(
    `INSERT INTO price_snapshots(booking_id,seq,kind,payload_json,gross_amount,commission_amount,
        policy_snapshot_json,engine_version)
     VALUES($1::uuid,1,'ORIGINAL',$2::jsonb,$3,$4,$5::jsonb,'hb097-test')`,
    [
      input.id,
      JSON.stringify({
        schemaVersion: 1,
        ratePlan: { id: 'rate-plan', code: 'FLEX7', version: 1, depositPercent: 30 },
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
          subtotal,
          discountAmount,
          grossAmount,
          commissionAmount,
          depositAmount: Math.ceil(grossAmount * 0.3),
          currency: 'VND',
        },
      }),
      input.total.toString(),
      commissionAmount.toString(),
      JSON.stringify(input.policy),
    ],
  );
}

const COMMISSION_PCT = 18;

function holdExpiryOf(status: string, input: BookingInput): Date | null {
  if (input.holdExpiresAt !== undefined) return input.holdExpiresAt;
  return status === 'HELD' ? clock.now() : null;
}

/** BookingRoom + nghĩa vụ ROOM mỗi phòng–đêm (đơn giá sau giảm, không đổi khi huỷ). */
async function insertRooms(
  id: string,
  rooms: readonly string[],
  nights: number,
  chargedNightly: number,
  day: (offset: number) => string,
): Promise<Map<string, string>> {
  const bookingRooms = new Map<string, string>();
  for (const room of rooms) {
    const bookingRoom = String(
      (
        await rows(
          `INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night)
           SELECT $1,room_type_id,1,$3 FROM rooms WHERE id=$2::uuid RETURNING id`,
          [id, room, chargedNightly],
        )
      )[0]!.id,
    );
    bookingRooms.set(room, bookingRoom);
    for (let night = 0; night < nights; night += 1)
      await rows(
        `INSERT INTO booking_charges(booking_id,booking_room_id,stay_date,kind,source_key,amount)
         VALUES($1::uuid,$2::uuid,$3::date,'ROOM',$4,$5)`,
        [id, bookingRoom, day(night), `room:${bookingRoom}:${day(night)}`, chargedNightly],
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
  const discount = input.discount ?? 0;
  const rooms = input.rooms ?? [roomId];
  const day = (offset: number) =>
    new Date(Date.parse(`${checkIn}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const policy = await insertPolicy(await flexPolicy());
  const holdExpiry = holdExpiryOf(status, input);
  const id = String(
    (
      await rows(
        `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,
            check_out,adults,deposit_percent,status,hold_expires_at,room_count,total_amount)
         SELECT $1,(SELECT id FROM guests LIMIT 1),$2,(SELECT room_type_id FROM rooms WHERE id=$3::uuid),
            (SELECT id FROM rate_plans WHERE code='FLEX7'),(SELECT id FROM channels WHERE code=$9),
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
          input.channel ?? 'WEB',
        ],
      )
    )[0]!.id,
  );
  // `booking_charges` là nghĩa vụ phòng–đêm **sau giảm giá** (csdl §3.6) ⇒ bằng tổng snapshot.
  const bookingRooms = await insertRooms(id, rooms, nights, price - discount, day);
  const total = BigInt(price - discount) * BigInt(nights) * BigInt(rooms.length);
  await rows('UPDATE bookings SET total_amount=$2, channel_policy_code=$3 WHERE id=$1', [
    id,
    total.toString(),
    input.channelPolicyCode ?? null,
  ]);
  await insertSnapshot({
    id,
    checkIn,
    checkOut: day(nights),
    nights,
    price,
    discount,
    total,
    policy,
    bookingRooms: [...bookingRooms.values()],
  });
  return { id, rooms: bookingRooms, total, checkIn, checkOut: day(nights), price: BigInt(price) };
}

/**
 * Thu tiền thật: Payment SUCCEEDED + phân bổ theo **đúng allocator của production** (trọng số phòng,
 * HB-211) để fixture không có công thức thứ hai.
 */
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
    `SELECT c.id, c.booking_room_id, c.amount,
            (c.amount - c.voided_amount - coalesce(sum(a.amount - a.released_amount), 0))::bigint
              AS outstanding
       FROM booking_charges c
       LEFT JOIN payment_allocations a ON a.charge_id = c.id
      WHERE c.booking_id=$1::uuid AND c.kind='ROOM'
      GROUP BY c.id
      ORDER BY c.id`,
    [bookingId],
  );
  for (const line of planReceiptAllocation(
    amount,
    charges.map((charge) => ({
      id: String(charge.id),
      kind: 'ROOM',
      roomId: charge.booking_room_id === null ? null : String(charge.booking_room_id),
      weight: BigInt(String(charge.amount)),
      outstanding: BigInt(String(charge.outstanding)),
    })),
    ['ROOM'],
  ))
    await rows(
      'INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1::uuid,$2::uuid,$3)',
      [payment, line.chargeId, line.amount.toString()],
    );
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
