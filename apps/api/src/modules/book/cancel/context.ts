import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { notAllowed } from './validation.js';

type Tx = PrismaTypes.TransactionClient;

export type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;
export type TierInput = z.infer<typeof tierJsonSchema>;

export interface RoomBasis {
  readonly roomId: string;
  readonly active: boolean;
  readonly weight: bigint;
  readonly firstNight: bigint;
}
export interface CancelFacts {
  readonly id: string;
  readonly propertyId: string;
  readonly status: string;
  readonly version: bigint;
  readonly checkIn: string;
  readonly rooms: readonly RoomBasis[];
  readonly receipts: readonly { readonly id: string; readonly amount: bigint }[];
  readonly policy: { readonly id: string; readonly tiers: readonly TierInput[] };
  /** Bản `policy_snapshot_json` nguyên trạng (object) để ghi lại khi tạo snapshot PARTIAL_CANCEL. */
  readonly policyJson: Record<string, z.infer<typeof jsonValueSchema>>;
  /** `payload_json` nguyên trạng (mọi khoá) để ghi lại **nguyên vẹn** khi tạo snapshot PARTIAL_CANCEL. */
  readonly payloadJson: JsonRecord;
  readonly channelCode: string;
  readonly channelPolicyCode: string | null;
  readonly checkInMs: number;
  readonly fee: bigint;
  readonly paidAmount: bigint;
  readonly payload: SnapshotPayload;
}
export interface CancelDecision {
  readonly hours: number;
  readonly tierId: string | null;
  readonly token: string;
  readonly policyId: string;
  readonly refundPercent: number;
  readonly base: bigint;
  readonly requested: bigint;
  readonly penalty: bigint;
  readonly fee: bigint;
  readonly net: bigint;
  readonly legs: readonly { readonly paymentId: string; readonly amount: bigint }[];
}

export interface DecisionInput {
  readonly state: 'HELD' | 'PENDING_PAYMENT' | 'CONFIRMED';
  readonly forceMajeure: boolean;
  readonly selected: readonly string[];
}

const jsonValueSchema = z.json();
const tierJsonSchema = z.object({
  id: z.string().min(1),
  offsetHours: z.number().int(),
  refundPercent: z.number(),
  chargeFirstNight: z.boolean(),
});
const policyJsonSchema = z.object({ id: z.string().min(1), tiers: z.array(tierJsonSchema).min(1) });
const policyRecordSchema = z.record(z.string(), jsonValueSchema);

export type JsonScalar = z.infer<typeof jsonValueSchema>;
export type JsonRecord = Record<string, JsonScalar>;

/** `jsonb NOT NULL` + `CHECK jsonb_typeof(...)='object'`: object JSON; guard kiểm lại khi đọc. */
export function jsonObject(value: JsonScalar, message: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw notAllowed(message);
  return value;
}
const nightsSchema = z.array(
  z.object({
    bookingRoomId: z.string().min(1),
    grossAmount: z.number().int().nonnegative(),
    // Hai trường dưới đây là tổng hợp theo đêm (csdl §3.6); thiếu thì coi như 0 khi tính lại tổng.
    commissionAmount: z.number().int().nonnegative().optional(),
    nightlyPrice: z.number().int().nonnegative().optional(),
  }),
);
/** `payload_json` theo csdl §3.6 / ADR-015: thiếu khoá bắt buộc thì dừng (fail closed), không đoán giá. */
export const snapshotPayloadSchema = z.object({
  schemaVersion: z.number().int().positive(),
  ratePlan: jsonValueSchema,
  policy: jsonValueSchema,
  stay: z.object({
    checkIn: z.string().min(1),
    checkOut: z.string().min(1),
    timezone: z.string().min(1),
    checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
    checkOutTime: z.string().min(1),
  }),
  nights: nightsSchema,
  totals: z.object({
    subtotal: z.number().int().nonnegative(),
    discountAmount: z.number().int().nonnegative(),
    grossAmount: z.number().int().nonnegative(),
    commissionAmount: z.number().int().nonnegative(),
    depositAmount: z.number().int().nonnegative(),
    currency: z.string().min(1),
  }),
});

/**
 * BR-GEN-04: mốc danh nghĩa = ngày checkIn lúc giờ nhận phòng theo múi giờ đã chốt.
 * VN không có DST nên độ lệch tính một lần qua Intl là chính xác.
 */
export function nominalCheckInMs(date: string, time: string, timeZone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw notAllowed('Ngày nhận phòng đã chốt không hợp lệ.');
  const stamp = `${date}T${time.length === 5 ? `${time}:00` : time}Z`;
  const wall = new Date(stamp).getTime();
  if (!Number.isFinite(wall)) throw notAllowed('Giờ nhận phòng đã chốt không hợp lệ.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(wall));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return (
    wall -
    (Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    ) -
      wall)
  );
}

interface BookingRow {
  id: string;
  property_id: string;
  status: string;
  version: bigint;
  check_in: Date;
  check_out: Date;
  timezone: string;
  channel_code: string;
  channel_policy_code: string | null;
}

async function loadBooking(tx: Tx, bookingId: string, lock: boolean): Promise<BookingRow> {
  const rows = await tx.$queryRaw<BookingRow[]>`
    SELECT b.id, b.property_id, b.status, b.version, b.check_in, b.check_out, p.timezone,
           c.code AS channel_code, b.channel_policy_code
      FROM bookings b
      JOIN properties p ON p.id = b.property_id
      JOIN channels c ON c.id = b.channel_id
     WHERE b.id = ${bookingId}::uuid
    ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
  const booking = rows[0];
  if (!booking) throw notAllowed('Không tìm thấy booking.');
  return booking;
}

/**
 * Nền phân bổ bất biến (BR-CANCEL-19): trọng số và giá đêm đầu lấy từ `booking_charges`
 * (nghĩa vụ phòng–đêm sau khuyến mãi; `amount` không đổi khi huỷ), không chia lại trên total đã giảm.
 */
async function loadRooms(tx: Tx, bookingId: string, checkIn: string): Promise<RoomBasis[]> {
  const rooms = await tx.booking_rooms.findMany({
    where: { booking_id: bookingId },
    orderBy: { id: 'asc' },
    select: { id: true, status: true },
  });
  const charges = await tx.booking_charges.findMany({
    where: { booking_id: bookingId, kind: 'ROOM' },
    select: { booking_room_id: true, stay_date: true, amount: true },
  });
  const weights = new Map<string, bigint>();
  const first = new Map<string, bigint>();
  for (const charge of charges) {
    if (!charge.booking_room_id || !charge.stay_date) continue;
    weights.set(
      charge.booking_room_id,
      (weights.get(charge.booking_room_id) ?? 0n) + charge.amount,
    );
    if (charge.stay_date.toISOString().slice(0, 10) === checkIn)
      first.set(charge.booking_room_id, (first.get(charge.booking_room_id) ?? 0n) + charge.amount);
  }
  return rooms.map((room) => {
    const weight = weights.get(room.id) ?? 0n;
    if (weight <= 0n) throw notAllowed('Thiếu nghĩa vụ phòng–đêm cho BookingRoom.');
    return {
      roomId: room.id,
      active: room.status === 'ACTIVE',
      weight,
      firstNight: first.get(room.id) ?? 0n,
    };
  });
}

async function loadReceipts(tx: Tx, bookingId: string) {
  const rows = await tx.payments.findMany({
    where: { booking_id: bookingId, status: 'SUCCEEDED', type: { in: ['DEPOSIT', 'BALANCE'] } },
    orderBy: { id: 'asc' },
    select: { id: true, amount: true },
  });
  return rows.map((row) => ({ id: row.id, amount: row.amount }));
}

async function loadSnapshot(tx: Tx, bookingId: string) {
  const snapshot = await tx.price_snapshots.findFirst({
    where: { booking_id: bookingId },
    orderBy: { seq: 'desc' },
    select: { policy_snapshot_json: true, payload_json: true },
  });
  if (!snapshot) throw notAllowed('Booking chưa có PriceSnapshot nên không thể huỷ.');
  const policy = policyJsonSchema.safeParse(snapshot.policy_snapshot_json);
  if (!policy.success) throw notAllowed('Snapshot chính sách huỷ không hợp lệ.');
  const policyJson = policyRecordSchema.safeParse(snapshot.policy_snapshot_json);
  if (!policyJson.success) throw notAllowed('Snapshot chính sách huỷ không hợp lệ.');
  const rawPayload = jsonValueSchema.safeParse(snapshot.payload_json);
  if (!rawPayload.success) throw notAllowed('Snapshot giá không hợp lệ.');
  const payloadJson = jsonObject(rawPayload.data, 'Snapshot giá không hợp lệ.');
  for (const tier of policy.data.tiers)
    if (!Number.isInteger(tier.refundPercent) || tier.refundPercent < 0 || tier.refundPercent > 100)
      throw notAllowed('Tỷ lệ hoàn trong snapshot phải là số nguyên 0..100.');
  const payload = snapshotPayloadSchema.safeParse(snapshot.payload_json);
  if (!payload.success) throw notAllowed('Snapshot giá không hợp lệ.');
  return {
    policy: policy.data,
    policyJson: policyJson.data,
    payload: payload.data,
    payloadJson,
  };
}

async function loadFee(tx: Tx): Promise<bigint> {
  const row = await tx.system_settings.findUnique({
    where: { key: 'refund.feeAmount' },
    select: { value: true },
  });
  const fee = BigInt(row?.value ?? '0');
  if (fee < 0n) throw notAllowed('Tham số phí hoàn tiền không hợp lệ.');
  return fee;
}

export async function readFacts(
  tx: Tx,
  bookingId: string,
  lock: boolean,
  paidAmount: bigint,
): Promise<CancelFacts> {
  const booking = await loadBooking(tx, bookingId, lock);
  const checkIn = booking.check_in.toISOString().slice(0, 10);
  const rooms = await loadRooms(tx, bookingId, checkIn);
  const snapshot = await loadSnapshot(tx, bookingId);
  return {
    id: booking.id,
    propertyId: booking.property_id,
    status: booking.status,
    version: booking.version,
    checkIn,
    rooms,
    receipts: await loadReceipts(tx, bookingId),
    policy: snapshot.policy,
    policyJson: snapshot.policyJson,
    payloadJson: snapshot.payloadJson,
    channelCode: booking.channel_code,
    channelPolicyCode: booking.channel_policy_code,
    checkInMs: nominalCheckInMs(
      checkIn,
      snapshot.payload.stay.checkInTime,
      snapshot.payload.stay.timezone,
    ),
    fee: await loadFee(tx),
    paidAmount,
    payload: snapshot.payload,
  };
}
