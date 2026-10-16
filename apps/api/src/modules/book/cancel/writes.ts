import { Prisma } from '@prisma/client';
import { DomainError } from '@pinehill/domain';
import { refundStatusSchema, type CancelRequest, type CancelResponse } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { RetryTransaction } from '../../../common/idempotency/transaction-retry.js';
import { BookingLedger } from '../../pay/ledger/service.js';
import { LedgerError } from '../../pay/ledger/projection.js';
import { exceedsPaid, notAllowed } from './validation.js';
import { jsonObject } from './context.js';
import type { CancelDecision, CancelFacts, JsonRecord, JsonScalar, RoomBasis } from './context.js';

export type Tx = Prisma.TransactionClient;
export type RefundView = CancelResponse['refundRequest'];

/** BR-CANCEL-17: các mã này nghĩa là hạn mức hoàn vượt tiền thực thu đủ điều kiện. */
const overPaid = ['LEDGER_SOURCE_CAP', 'LEDGER_BOOKING_CAP', 'LEDGER_REFUND_NET'];

export function safeAmount(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw notAllowed('Số tiền vượt giới hạn an toàn.');
  return Number(value);
}

function ledgerFailure(reason: string): AppError {
  return overPaid.includes(reason)
    ? exceedsPaid()
    : notAllowed('Sổ tiền của booking không cho phép huỷ theo yêu cầu này.');
}

function prismaFailure(error: Prisma.PrismaClientKnownRequestError): AppError | RetryTransaction {
  const raw = String(error.meta?.code ?? '');
  if (
    error.code === 'P2034' ||
    (error.code === 'P2010' && ['55P03', '40P01', '40001'].includes(raw))
  )
    return new RetryTransaction(
      new AppError(409, 'E_SYS_REQUEST_IN_PROGRESS', 'Booking đang được cập nhật.', 1),
    );
  // Ràng buộc/trigger CSDL từ chối: khoá sự kiện trùng, hạn mức hoàn, trạng thái huỷ.
  return notAllowed('Dữ liệu huỷ đã thay đổi; hãy tải lại và thử lại.');
}

export function safeError(error: unknown): never {
  if (error instanceof AppError || error instanceof RetryTransaction) throw error;
  if (error instanceof LedgerError) throw ledgerFailure(error.reason);
  if (error instanceof DomainError) throw notAllowed('Không thể tính tiền huỷ cho booking này.');
  if (error instanceof Prisma.PrismaClientKnownRequestError) throw prismaFailure(error);
  throw error;
}

/** BR-BOOK-11: nhả mọi RoomAssignment của phòng bị huỷ trong cùng transaction. */
export async function releaseAssignments(
  tx: Tx,
  selected: readonly string[],
  reason: string,
  now: Date,
): Promise<number> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM room_assignments
     WHERE booking_room_id = ANY(${[...selected]}::uuid[]) AND released_at IS NULL
     ORDER BY id FOR UPDATE`;
  if (!rows.length) return 0;
  await tx.room_assignments.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: { released_at: now, release_reason: reason, updated_at: now },
  });
  return rows.length;
}

/** Nhả phân bổ và void nghĩa vụ phòng bị huỷ — tiền phòng trở lại nguồn thu (BR-CANCEL-19). */
export async function voidRoomCharges(
  tx: Tx,
  bookingId: string,
  selected: readonly string[],
  reason: string,
  now: Date,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE payment_allocations SET released_amount = amount, release_reason = ${reason},
           updated_at = ${now}::timestamptz
     WHERE released_amount < amount AND charge_id IN (
       SELECT id FROM booking_charges
        WHERE booking_id = ${bookingId}::uuid AND kind = 'ROOM'
          AND booking_room_id = ANY(${[...selected]}::uuid[]))`;
  await tx.$executeRaw`
    UPDATE booking_charges SET voided_amount = amount, reason = ${reason},
           updated_at = ${now}::timestamptz
     WHERE voided_amount < amount AND booking_id = ${bookingId}::uuid AND kind = 'ROOM'
       AND booking_room_id = ANY(${[...selected]}::uuid[])`;
}

/** BR-CANCEL-19: giảm tổng giá phần ở còn lại; huỷ hết phòng mới chuyển CANCELLED. */
export async function closeBooking(
  tx: Tx,
  facts: CancelFacts,
  full: boolean,
  input: CancelRequest,
  now: Date,
): Promise<bigint> {
  const total = await tx.$queryRaw<{ total_amount: bigint }[]>`
    UPDATE bookings SET
      total_amount = (SELECT coalesce(sum(amount - voided_amount), 0) FROM booking_charges
                       WHERE booking_id = ${facts.id}::uuid AND kind = 'ROOM'),
      status = CASE WHEN ${full} THEN 'CANCELLED' ELSE status END,
      cancelled_at = CASE WHEN ${full} THEN ${now}::timestamptz ELSE cancelled_at END,
      cancel_reason = CASE WHEN ${full} THEN ${input.reason}::text ELSE cancel_reason END,
      updated_at = ${now}::timestamptz
     WHERE id = ${facts.id}::uuid
    RETURNING total_amount`;
  if (full)
    await tx.booking_status_history.create({
      data: {
        booking_id: facts.id,
        from_status: facts.status,
        to_status: 'CANCELLED',
        reason: input.note ?? input.reason,
        at: now,
      },
    });
  return total[0]!.total_amount;
}

/** BR-CANCEL-06: phụ thu đêm đầu ghi công nợ `PENALTY` PENDING, không tự thu. */
export async function recordPenalty(
  tx: Tx,
  facts: CancelFacts,
  decision: CancelDecision,
  selected: readonly string[],
  actorId: string,
  now: Date,
): Promise<string> {
  const key = `cancel-penalty:${[...selected].sort().join(',')}`;
  const charge = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO booking_charges(booking_id, kind, source_key, amount, reason, created_at, updated_at)
    VALUES(${facts.id}::uuid, 'PENALTY', ${key}, ${decision.penalty}, 'Phụ thu đêm đầu khi huỷ',
           ${now}::timestamptz, ${now}::timestamptz)
    RETURNING id`;
  await tx.$executeRaw`
    INSERT INTO payments(booking_id, type, method, amount, status, idempotency_key, created_by, note,
                         created_at, updated_at)
    VALUES(${facts.id}::uuid, 'PENALTY', 'CASH', ${decision.penalty}, 'PENDING', ${key},
           ${actorId}::uuid, 'Phụ thu đêm đầu khi huỷ (BR-CANCEL-06)',
           ${now}::timestamptz, ${now}::timestamptz)`;
  await tx.$executeRaw`
    UPDATE bookings SET penalty_amount = (SELECT coalesce(sum(amount - voided_amount), 0)
             FROM booking_charges WHERE booking_id = ${facts.id}::uuid AND kind = 'PENALTY'),
           updated_at = ${now}::timestamptz
     WHERE id = ${facts.id}::uuid`;
  return charge[0]!.id;
}

/**
 * BR-BOOK-14/BR-CANCEL-17: chỉ lập RefundRequest khi net > 0, rồi **giữ hạn mức** qua ledger
 * (`refund_allocations`), không tự ghi số dư. Không lập ⇒ đồng bộ lại projection trong cùng TX.
 */
export async function recordRefund(
  tx: Tx,
  ledger: BookingLedger,
  actor: AuthorizedActor,
  facts: CancelFacts,
  decision: CancelDecision,
  input: CancelRequest,
  selected: readonly string[],
  channelManaged: boolean,
  now: Date,
): Promise<RefundView> {
  if (channelManaged || decision.net <= 0n) {
    await ledger.sync(tx, facts.id, actor);
    return null;
  }
  const payments = decision.legs.map((leg) => leg.paymentId);
  const rows = await tx.$queryRaw<
    { id: string; status: string; approved_amount: bigint | null; net_refund: bigint }[]
  >`
    INSERT INTO refund_requests(booking_id, event_key, payment_id, policy_id, hours_before_check_in,
      applied_tier_id, refund_percent, requested_amount, refund_fee, status, is_force_majeure,
      evidence_refs, reason, requested_by, requester_type, requester_id, created_at, updated_at)
    VALUES(${facts.id}::uuid, ${`cancel:${[...selected].sort().join(',')}`},
      ${payments.length === 1 ? payments[0]! : null}::uuid, ${facts.policy.id}::uuid,
      ${decision.hours.toFixed(2)}::numeric, ${decision.tierId}::uuid,
      ${decision.refundPercent}::numeric, ${decision.requested}, ${decision.fee}, 'PENDING',
      ${input.isForceMajeure}, ${input.evidenceRefs ?? []}::text[], ${input.reason},
      ${actor.id}::uuid, 'USER', ${actor.id}, ${now}::timestamptz, ${now}::timestamptz)
    RETURNING id, status, approved_amount, net_refund`;
  const request = rows[0]!;
  if (request.net_refund !== decision.net) throw exceedsPaid();
  await ledger.reserve(
    tx,
    facts.id,
    request.id,
    decision.legs.map((leg) => ({ paymentId: leg.paymentId, amount: leg.amount })),
    actor,
  );
  return {
    id: request.id,
    status: refundStatusSchema.parse(request.status),
    approvedAmount: request.approved_amount === null ? null : safeAmount(request.approved_amount),
  };
}

/**
 * BR-CANCEL-19/BR-RATE-16: giữ bản gốc, thêm snapshot PARTIAL_CANCEL cho phần ở lại.
 * `payload_json` là **bản sao nguyên vẹn** của bản mới nhất (giữ `date`, giá cơ bản, mọi hệ số, nguồn/
 * ID/version giá và hoa hồng từng đêm — csdl §3.6): chỉ lọc `nights[]` theo phòng ở lại rồi **tính lại
 * mọi tổng từ chính các đêm đó**, để JSON khớp hai cột `gross_amount`/`commission_amount`.
 * `depositAmount` giữ nguyên giá trị của bản nguồn: cọc tính theo BR-PAY-01 từ `ratePlan.depositPercent`
 * và không suy ra được từ danh sách đêm, nên không tự dựng lại công thức tiền ở tầng API.
 */
export async function partialSnapshot(
  tx: Tx,
  facts: CancelFacts,
  leaving: readonly RoomBasis[],
  total: bigint,
  now: Date,
): Promise<void> {
  const source = await tx.price_snapshots.findFirstOrThrow({
    where: { booking_id: facts.id },
    orderBy: { seq: 'desc' },
    select: { seq: true, engine_version: true },
  });
  const remaining = new Set(leaving.map((room) => room.roomId));
  const nights = nightsOf(facts.payloadJson).filter((night) => remaining.has(roomOfNight(night)));
  const totals = totalsOf(nights);
  if (totals.grossAmount !== safeAmount(total))
    throw notAllowed('Nghĩa vụ phòng–đêm không khớp snapshot giá.');
  await tx.price_snapshots.create({
    data: {
      booking_id: facts.id,
      seq: source.seq + 1,
      kind: 'PARTIAL_CANCEL',
      payload_json: {
        ...facts.payloadJson,
        nights,
        totals: {
          ...jsonObject(facts.payloadJson.totals ?? null, 'Tổng snapshot giá không hợp lệ.'),
          ...totals,
        },
      },
      policy_snapshot_json: facts.policyJson,
      gross_amount: total,
      commission_amount: BigInt(totals.commissionAmount),
      engine_version: source.engine_version,
      captured_at: now,
    },
  });
}

function nightsOf(payload: JsonRecord): JsonScalar[] {
  const value = payload.nights;
  if (!Array.isArray(value)) throw notAllowed('Snapshot giá thiếu danh sách đêm.');
  return value;
}

function roomOfNight(night: JsonScalar): string {
  const value = jsonObject(night, 'Đêm trong snapshot giá không hợp lệ.').bookingRoomId;
  if (typeof value !== 'string' || !value.trim())
    throw notAllowed('Đêm trong snapshot giá không hợp lệ.');
  return value;
}

/** Số tiền nguyên VND của một trường theo đêm; `required` khi tổng hợp buộc phải có. */
function amountOf(night: JsonRecord, key: string, required: boolean): number | null {
  const value = night[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (required) throw notAllowed('Đêm trong snapshot giá thiếu số tiền.');
  return null;
}

/** Tổng của các đêm còn lại: `subtotal` = Σ giá cơ bản, `discountAmount` = subtotal − gross (csdl §3.6). */
function totalsOf(nights: readonly JsonScalar[]) {
  let subtotal = 0,
    gross = 0,
    commission = 0;
  for (const night of nights) {
    const value = jsonObject(night, 'Đêm trong snapshot giá không hợp lệ.');
    const nightGross = amountOf(value, 'grossAmount', true)!;
    gross += nightGross;
    subtotal += amountOf(value, 'nightlyPrice', false) ?? nightGross;
    commission += amountOf(value, 'commissionAmount', false) ?? 0;
  }
  if (subtotal < gross) throw notAllowed('Tổng các đêm còn lại không hợp lệ.');
  return {
    subtotal,
    discountAmount: subtotal - gross,
    grossAmount: gross,
    commissionAmount: commission,
  };
}
