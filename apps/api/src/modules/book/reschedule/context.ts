/**
 * Dữ kiện đã **khoá** của lệnh đổi ngày (HB-098; BR-BOOK-12/13/18, ADR-014/015):
 * `bookings` (chính booking, `FOR UPDATE`) → `properties` → `room_types` → `rooms` (`lockStock` của
 * HB-076 giữ đúng thứ tự ADR-014), rồi đọc gói giá, danh sách đơn vị bán và **bản snapshot ORIGINAL**.
 *
 * Vì sao phải đọc ORIGINAL: ADR-015 §7 yêu cầu giữ policy hợp đồng gốc (không đọc policy live), và
 * mốc thời gian BR-GEN-04 (giờ nhận phòng danh nghĩa) lấy từ `stay` đã chốt trong snapshot gốc. Thiếu
 * ORIGINAL ⇒ fail closed: không có hợp đồng giá thì không thể đổi ngày.
 */
import type { Prisma as PrismaTypes } from '@prisma/client';
import { z } from 'zod';
import type { JsonRecord } from '../cancel/context.js';
import type { PolicySnapshot } from '../bookings/policy.js';
import type { SnapshotStay } from '../bookings/snapshot.js';
import { notAllowed } from './validation.js';

type Tx = PrismaTypes.TransactionClient;

export interface RescheduleRatePlan {
  readonly id: string;
  readonly code: string;
  readonly minNights: number;
  readonly maxNights: number;
  readonly losDiscountEnabled: boolean;
  readonly depositPercent: number;
  readonly rescheduleAllowed: boolean;
  readonly rescheduleMinHours: number;
  readonly rescheduleFeePct: number;
  readonly maxReschedules: number;
}

export interface RescheduleRoom {
  readonly id: string;
  readonly pricePerNight: bigint;
}

export interface RescheduleFacts {
  readonly id: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly channelId: string;
  readonly channelCode: string;
  readonly status: string;
  readonly version: bigint;
  readonly holdExpiresAt: Date | null;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly roomCount: number;
  readonly totalAmount: bigint;
  readonly rescheduleCount: number;
  readonly plan: RescheduleRatePlan;
  readonly rooms: readonly RescheduleRoom[];
  readonly policy: PolicySnapshot;
  /** `policy_snapshot_json` nguyên trạng của ORIGINAL — ghi lại nguyên vẹn vào snapshot RESCHEDULE. */
  readonly policyJson: JsonRecord;
  readonly stay: SnapshotStay;
  /** `seq` của bản snapshot mới nhất — bản RESCHEDULE dùng `seq + 1` (BR-RATE-16). */
  readonly snapshotSeq: number;
  /** Giờ CSDL đọc **sau** khoá (BR-BOOK-18) — dùng cho mọi quyết định thời gian của lệnh. */
  readonly now: Date;
}

const lockedBookingSchema = z.object({
  id: z.string().uuid(),
  property_id: z.string().uuid(),
  room_type_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  channel_code: z.string().min(1),
  rate_plan_id: z.string().uuid(),
  status: z.string().min(1),
  version: z.bigint(),
  hold_expires_at: z.date().nullable(),
  check_in: z.string(),
  check_out: z.string(),
  adults: z.number(),
  children: z.number(),
  room_count: z.number(),
  total_amount: z.bigint(),
  reschedule_count: z.number(),
});

const policySchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  tiers: z
    .array(
      z.object({
        id: z.string().min(1),
        offsetHours: z.number().int(),
        refundPercent: z.number().int().min(0).max(100),
        chargeFirstNight: z.boolean(),
      }),
    )
    .min(1),
});

const staySchema = z.object({
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  timezone: z.string().min(1),
  checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  checkOutTime: z.string().min(1),
});

/** `policy_snapshot_json` là object JSON (cột `jsonb` + CHECK `jsonb_typeof = 'object'`). */
const policyRecordSchema = z.record(z.string(), z.json());

async function lockedBooking(tx: Tx, bookingId: string) {
  const rows = await tx.$queryRaw<unknown[]>`
    SELECT b.id, b.property_id, b.room_type_id, b.channel_id, c.code AS channel_code,
           b.rate_plan_id, b.status, b.version, b.hold_expires_at,
           to_char(b.check_in, 'YYYY-MM-DD') AS check_in,
           to_char(b.check_out, 'YYYY-MM-DD') AS check_out,
           b.adults, b.children, b.room_count, b.total_amount, b.reschedule_count
      FROM bookings b
      JOIN channels c ON c.id = b.channel_id
     WHERE b.id = ${bookingId}::uuid
     FOR UPDATE OF b`;
  const parsed = lockedBookingSchema.safeParse(rows[0]);
  // Không tồn tại là `404` do `authorize` của use case quyết trước; đây là bất biến nội bộ.
  if (!parsed.success) throw notAllowed('Không đọc được đặt phòng để đổi ngày.');
  return parsed.data;
}

/** Policy hợp đồng gốc + mốc giờ danh nghĩa, đọc từ bản snapshot ORIGINAL (ADR-015 §4,7). */
async function originalContract(tx: Tx, bookingId: string) {
  const snapshot = await tx.price_snapshots.findFirst({
    where: { booking_id: bookingId, kind: 'ORIGINAL' },
    select: { seq: true, payload_json: true, policy_snapshot_json: true },
  });
  if (snapshot === null) throw notAllowed('Đặt phòng chưa có ảnh giá gốc nên không thể đổi ngày.');
  const policy = policySchema.safeParse(snapshot.policy_snapshot_json);
  const policyJson = policyRecordSchema.safeParse(snapshot.policy_snapshot_json);
  const payload = z.object({ stay: staySchema }).safeParse(snapshot.payload_json);
  if (!policy.success || !policyJson.success || !payload.success)
    throw notAllowed('Ảnh giá gốc của đặt phòng không hợp lệ.');
  const latest = await tx.price_snapshots.findFirstOrThrow({
    where: { booking_id: bookingId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });
  return {
    policy,
    policyJson: policyJson.data,
    stay: payload.data.stay,
    snapshotSeq: Math.max(snapshot.seq, latest.seq),
  };
}

export async function lockRescheduleFacts(tx: Tx, bookingId: string): Promise<RescheduleFacts> {
  const booking = await lockedBooking(tx, bookingId);
  const plan = await tx.rate_plans.findUniqueOrThrow({
    where: { id: booking.rate_plan_id },
    select: {
      id: true,
      code: true,
      min_nights: true,
      max_nights: true,
      los_discount_enabled: true,
      deposit_percent: true,
      reschedule_allowed: true,
      reschedule_min_hours: true,
      reschedule_fee_pct: true,
      max_reschedules: true,
    },
  });
  const rooms = await tx.booking_rooms.findMany({
    where: { booking_id: bookingId, status: 'ACTIVE' },
    orderBy: { id: 'asc' },
    select: { id: true, price_per_night: true },
  });
  if (rooms.length !== booking.room_count)
    throw notAllowed('Số đơn vị bán của đặt phòng không khớp số phòng đang hoạt động.');
  const contract = await originalContract(tx, bookingId);
  const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
  return {
    id: booking.id,
    propertyId: booking.property_id,
    roomTypeId: booking.room_type_id,
    channelId: booking.channel_id,
    channelCode: booking.channel_code,
    status: booking.status,
    version: booking.version,
    holdExpiresAt: booking.hold_expires_at,
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    adults: booking.adults,
    children: booking.children,
    roomCount: booking.room_count,
    totalAmount: booking.total_amount,
    rescheduleCount: booking.reschedule_count,
    plan: {
      id: plan.id,
      code: plan.code,
      minNights: plan.min_nights,
      maxNights: plan.max_nights,
      losDiscountEnabled: plan.los_discount_enabled,
      depositPercent: Number(plan.deposit_percent),
      rescheduleAllowed: plan.reschedule_allowed,
      rescheduleMinHours: plan.reschedule_min_hours,
      rescheduleFeePct: Number(plan.reschedule_fee_pct),
      maxReschedules: plan.max_reschedules,
    },
    rooms: rooms.map((room) => ({ id: room.id, pricePerNight: room.price_per_night })),
    policy: contract.policy.data,
    policyJson: contract.policyJson,
    stay: contract.stay,
    snapshotSeq: contract.snapshotSeq,
    now,
  };
}
