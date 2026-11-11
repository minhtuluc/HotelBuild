/** Ghi CSDL cho lệnh điều chuyển/walk-out. Mọi hàm chạy trong transaction của caller. */
import type { Prisma } from '@prisma/client';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { Tx } from '../support.js';
import { businessDate, invalid, notFound } from '../support.js';
import type { MoveRow } from '../views.js';

export interface BookingRow {
  id: string;
  property_id: string;
  room_type_id: string;
  guest_id: string;
  rate_plan_id: string;
  channel_id: string;
  status: string;
  check_in: Date;
  check_out: Date;
  adults: number;
  children: number;
  total_amount: bigint;
  paid_amount: bigint;
  deposit_amount: bigint;
  version: bigint;
}

export interface RoomTarget {
  id: string;
  property_id: string;
  room_type_id: string;
  status: string;
  bed_count: number;
  allow_shared: boolean;
  capacity_adults: number;
  base_price: bigint;
  code: string;
}

export async function lockMove(tx: Tx, moveId: string): Promise<MoveRow> {
  const rows = await tx.$queryRaw<MoveRow[]>`
    SELECT * FROM room_moves WHERE id=${moveId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw notFound('Không tìm thấy lệnh điều chuyển.');
  return row;
}

export async function lockBooking(tx: Tx, bookingId: string): Promise<BookingRow> {
  const rows = await tx.$queryRaw<BookingRow[]>`
    SELECT id, property_id, room_type_id, guest_id, rate_plan_id, channel_id, status,
           check_in, check_out, adults, children, total_amount, paid_amount, deposit_amount, version
      FROM bookings WHERE id=${bookingId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw notFound('Không tìm thấy booking.');
  return row;
}

export async function lockTargetRoom(tx: Tx, roomId: string): Promise<RoomTarget> {
  const rows = await tx.$queryRaw<RoomTarget[]>`
    SELECT r.id, r.property_id, r.room_type_id, r.status, r.bed_count,
           rt.allow_shared, rt.capacity_adults, rt.base_price, rt.code
      FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id
     WHERE r.id=${roomId}::uuid FOR UPDATE OF r`;
  const row = rows[0];
  if (row === undefined) throw notFound('Không tìm thấy phòng đích.');
  return row;
}

/** Khoá nhiều phòng theo thứ tự UUID ổn định (chống deadlock giữa hai execute). */
export async function lockRooms(tx: Tx, roomIds: readonly string[]): Promise<void> {
  const ids = [...new Set(roomIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM rooms WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

export async function releaseAssignmentsOf(
  tx: Tx,
  bookingRoomId: string,
  reason: string,
  now: Date,
): Promise<number> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM room_assignments
     WHERE booking_room_id=${bookingRoomId}::uuid AND released_at IS NULL
     ORDER BY id FOR UPDATE`;
  if (rows.length === 0) return 0;
  await tx.room_assignments.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: { released_at: now, release_reason: reason, updated_at: now },
  });
  return rows.length;
}

export async function activeAssignmentsOf(
  tx: Tx,
  bookingRoomId: string,
): Promise<{ id: string }[]> {
  return tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM room_assignments
     WHERE booking_room_id=${bookingRoomId}::uuid AND released_at IS NULL ORDER BY id`;
}

/** Giường trống kế tiếp của phòng đa giường trong khoảng lưu trú. */
export async function freeBed(
  tx: Tx,
  roomId: string,
  checkIn: string,
  checkOut: string,
  bedCount: number,
): Promise<number> {
  const used = await tx.$queryRaw<{ bed_no: number }[]>`SELECT DISTINCT bed_no FROM room_assignments
      WHERE room_id=${roomId}::uuid AND released_at IS NULL
        AND valid_range && daterange(${checkIn}::date, ${checkOut}::date, '[)')`;
  const taken = new Set(used.map((row) => Number(row.bed_no)));
  for (let bed = 1; bed <= bedCount; bed += 1) if (!taken.has(bed)) return bed;
  throw invalid('Phòng ghép đã hết giường trống cho kỳ lưu trú.');
}

export async function insertAssignment(
  tx: Tx,
  assignment: {
    bookingRoomId: string;
    roomId: string;
    bedNo: number;
    checkIn: string;
    checkOut: string;
  },
): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO room_assignments(booking_room_id, room_id, bed_no, start_date, end_date)
    VALUES(${assignment.bookingRoomId}::uuid, ${assignment.roomId}::uuid, ${assignment.bedNo},
           ${assignment.checkIn}::date, ${assignment.checkOut}::date) RETURNING id`;
  return rows[0]!.id;
}

export async function setMoveStatus(tx: Tx, moveId: string, status: string, now: Date) {
  await tx.$executeRaw`
    UPDATE room_moves SET status=${status}, updated_at=${now}::timestamptz
     WHERE id=${moveId}::uuid`;
}

/** Nhả phân bổ và void toàn bộ nghĩa vụ ROOM của booking (BR-CANCEL-19). */
export async function voidRoomCharges(
  tx: Tx,
  bookingId: string,
  reason: string,
  now: Date,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE payment_allocations SET released_amount=amount, release_reason=${reason},
           updated_at=${now}::timestamptz
     WHERE released_amount < amount AND charge_id IN (
       SELECT id FROM booking_charges WHERE booking_id=${bookingId}::uuid AND kind='ROOM')`;
  await tx.$executeRaw`
    UPDATE booking_charges SET voided_amount=amount, reason=${reason},
           updated_at=${now}::timestamptz
     WHERE voided_amount < amount AND booking_id=${bookingId}::uuid AND kind='ROOM'`;
}

export async function refundFeeOf(tx: Tx): Promise<bigint> {
  const row = await tx.system_settings.findUnique({
    where: { key: 'refund.feeAmount' },
    select: { value: true },
  });
  if (row === null) return 0n;
  try {
    const fee = BigInt(row.value);
    return fee > 0n ? fee : 0n;
  } catch {
    return 0n;
  }
}

export interface WalkOutRefundInput {
  readonly booking: BookingRow;
  readonly moveId: string;
  readonly actor: AuthorizedActor;
  readonly requestedAmount: bigint;
  readonly refundFee: bigint;
  readonly evidenceRefs: readonly string[];
  readonly now: Date;
  readonly paymentId: string | null;
}

export interface RelocationRefundInput {
  readonly booking: BookingRow;
  /** Khoá idempotent của sự kiện (`uq_refund_event`): `walkout:<moveId>` hoặc `merge:<mergeId>`. */
  readonly eventKey: string;
  readonly actor: AuthorizedActor;
  readonly requestedAmount: bigint;
  readonly refundFee: bigint;
  readonly evidenceRefs: readonly string[];
  readonly now: Date;
  readonly paymentId: string | null;
}

/** Hồ sơ hoàn HOTEL_RELOCATION PENDING, 100% số được hoàn, duyệt theo luồng hoàn hai cấp hiện có. */
export async function insertRelocationRefund(
  tx: Tx,
  input: RelocationRefundInput,
): Promise<string> {
  const ratePlan = await tx.$queryRaw<
    { cancellation_policy_id: string }[]
  >`SELECT cancellation_policy_id FROM rate_plans WHERE id=${input.booking.rate_plan_id}::uuid`;
  const policyId = ratePlan[0]?.cancellation_policy_id;
  if (policyId === undefined) throw invalid('Booking thiếu chính sách huỷ để lập hồ sơ hoàn.');
  const checkIn = businessDate(input.booking.check_in);
  const hours = (Date.parse(`${checkIn}T14:00:00+07:00`) - input.now.getTime()) / 3_600_000;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO refund_requests(booking_id, event_key, payment_id, policy_id, hours_before_check_in,
      applied_tier_id, refund_percent, requested_amount, refund_fee, status, is_force_majeure,
      evidence_refs, reason, requested_by, requester_type, requester_id, created_at, updated_at)
    VALUES(${input.booking.id}::uuid, ${input.eventKey},
      ${input.paymentId}::uuid, ${policyId}::uuid, ${hours.toFixed(2)}::numeric,
      NULL, 100::numeric, ${input.requestedAmount}, ${input.refundFee}, 'PENDING', false,
      ${[...input.evidenceRefs]}::text[], 'HOTEL_RELOCATION', ${input.actor.id}::uuid, 'USER',
      ${input.actor.id}, ${input.now}::timestamptz, ${input.now}::timestamptz)
    RETURNING id`;
  return rows[0]!.id;
}

/** Hồ sơ hoàn walk-out: 100% trên số đã thu, phí theo cấu hình (F6-D02). */
export function insertWalkOutRefund(tx: Tx, input: WalkOutRefundInput): Promise<string> {
  const { moveId, ...rest } = input;
  return insertRelocationRefund(tx, { ...rest, eventKey: `walkout:${moveId}` });
}

/** Phân bổ số hoàn NET trên các nguồn thu còn khả dụng, thứ tự UUID ổn định như `BookingLedger`. */
export function reservationLegs(
  sources: readonly { paymentId: string; available: bigint }[],
  net: bigint,
): { paymentId: string; amount: bigint }[] {
  let left = net;
  const legs: { paymentId: string; amount: bigint }[] = [];
  for (const source of [...sources].sort((a, b) => a.paymentId.localeCompare(b.paymentId))) {
    if (left <= 0n) break;
    if (source.available <= 0n) continue;
    const amount = source.available < left ? source.available : left;
    legs.push({ paymentId: source.paymentId, amount });
    left -= amount;
  }
  if (left > 0n) throw invalid('Quỹ hoàn không đủ cho số phải hoàn.');
  return legs;
}

/** Huỷ toàn booking do walk-out: giữ paidAmount, void nghĩa vụ, ghi lịch sử trạng thái. */
export async function closeBookingForWalkOut(
  tx: Tx,
  booking: BookingRow,
  actorId: string,
  now: Date,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE bookings SET
      total_amount=(SELECT coalesce(sum(amount - voided_amount),0) FROM booking_charges
                     WHERE booking_id=${booking.id}::uuid AND kind='ROOM'),
      status='CANCELLED', cancelled_at=${now}::timestamptz, cancel_reason='HOTEL_RELOCATION',
      updated_at=${now}::timestamptz
     WHERE id=${booking.id}::uuid`;
  await tx.booking_status_history.create({
    data: {
      booking_id: booking.id,
      from_status: booking.status,
      to_status: 'CANCELLED',
      reason: 'HOTEL_RELOCATION',
      actor_id: actorId,
      at: now,
    },
  });
}

export async function writeOverOutbox(
  tx: Tx,
  event: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.outbox_events.create({
    data: {
      event_type: event.eventType,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      payload_json: event.payload,
    },
  });
}

interface RoomChargeRow {
  id: string;
  amount: bigint;
  voided_amount: bigint;
}

/**
 * Void `take` VND nghĩa vụ của **một** charge ROOM rồi nhả phần phân bổ vượt nghĩa vụ còn lại.
 * Charge và các phân bổ của nó đã bị khoá `FOR UPDATE` theo thứ tự ổn định.
 */
async function voidChargePart(
  tx: Tx,
  charge: RoomChargeRow,
  take: bigint,
  now: Date,
): Promise<void> {
  const voided = charge.voided_amount + take;
  await tx.$executeRaw`
      UPDATE booking_charges SET voided_amount=${voided}, reason='MERGE_DISCOUNT',
             updated_at=${now}::timestamptz
       WHERE id=${charge.id}::uuid`;
  const allocations = await tx.$queryRaw<
    { id: string; amount: bigint; released_amount: bigint }[]
  >`SELECT id, amount, released_amount FROM payment_allocations
        WHERE charge_id=${charge.id}::uuid ORDER BY id FOR UPDATE`;
  const applied = allocations.reduce((sum, row) => sum + row.amount - row.released_amount, 0n);
  const open = charge.amount - voided;
  let excess = applied > open ? applied - open : 0n;
  for (const allocation of allocations) {
    if (excess <= 0n) break;
    const releasable = allocation.amount - allocation.released_amount;
    if (releasable <= 0n) continue;
    const release = releasable < excess ? releasable : excess;
    await tx.$executeRaw`
        UPDATE payment_allocations SET released_amount=released_amount + ${release},
               release_reason='MERGE_DISCOUNT', updated_at=${now}::timestamptz
         WHERE id=${allocation.id}::uuid`;
    excess -= release;
  }
}

/** Giảm nghĩa vụ ROOM của một booking đúng `reduction` VND, nhả phân bổ vượt mức. */
export async function reduceObligation(
  tx: Tx,
  bookingId: string,
  reduction: bigint,
  now: Date,
): Promise<void> {
  if (reduction <= 0n) return;
  const charges = await tx.$queryRaw<RoomChargeRow[]>`
      SELECT id, amount, voided_amount FROM booking_charges
      WHERE booking_id=${bookingId}::uuid AND kind='ROOM'
      ORDER BY stay_date NULLS LAST, id FOR UPDATE`;
  let left = reduction;
  for (const charge of charges) {
    if (left <= 0n) break;
    const room = charge.amount - charge.voided_amount;
    const take = room < left ? room : left;
    if (take <= 0n) continue;
    await voidChargePart(tx, charge, take, now);
    left -= take;
  }
  if (left > 0n) throw invalid('Không thể giảm nghĩa vụ ghép phòng quá số tiền phòng.');
  await tx.$executeRaw`
    UPDATE bookings SET
      total_amount=(SELECT coalesce(sum(amount - voided_amount),0) FROM booking_charges
                     WHERE booking_id=${bookingId}::uuid AND kind='ROOM'),
      balance_due=greatest(0,
        (SELECT coalesce(sum(amount - voided_amount),0) FROM booking_charges
          WHERE booking_id=${bookingId}::uuid AND kind='ROOM') - paid_amount),
      updated_at=${now}::timestamptz
     WHERE id=${bookingId}::uuid`;
}
