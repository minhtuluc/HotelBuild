/**
 * Fixture HB-212 (tách khỏi `harness.ts` để tệp HB-078 giữ nguyên, dưới hạn 400 dòng của lint).
 *
 * Dựng đúng hình dạng dữ liệu mà luồng PSP để lại **trước** khi hold hết hạn: nghĩa vụ ROOM mỗi phòng–đêm
 * và một chứng từ thu SUCCEEDED **đã phân bổ** (⇒ `available = 0`, buộc đường hết hạn phải nhả phân bổ mới
 * giữ được hạn mức hoàn theo BR-CANCEL-17). Ngoài ra đọc lại trạng thái tiền để đếm hồ sơ (idempotency) và
 * so **đúng số đã thu**.
 */
import type { PrismaClient } from '@prisma/client';
import { seedHold, type HoldFixture, type SeedHoldInput } from './harness.js';

export interface CollectedHold {
  readonly fixture: HoldFixture;
  readonly paymentId: string;
}

/** Lấy đúng một hàng của câu `INSERT ... RETURNING`; thiếu hàng là lỗi fixture. */
function onlyRow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`fixture HB-212: không dựng được ${what}`);
  return row;
}

/** Hold đến hạn **đã thu tiền**: nghĩa vụ ROOM theo phòng–đêm + chứng từ thu đã phân bổ. */
export async function seedCollectedHold(
  db: PrismaClient,
  input: SeedHoldInput & { readonly paidAmount: bigint },
): Promise<CollectedHold> {
  const fixture = await seedHold(db, input);
  const charges = await db.$queryRaw<{ id: string; amount: bigint }[]>`
    INSERT INTO booking_charges(booking_id, booking_room_id, stay_date, kind, source_key, amount)
    SELECT br.booking_id, br.id, day::date, 'ROOM',
           'room:' || br.id::text || ':' || day::date::text, br.price_per_night
      FROM booking_rooms br,
           generate_series(${fixture.checkIn}::date, ${fixture.checkOut}::date - 1, '1 day') AS day
     WHERE br.booking_id = ${fixture.bookingId}::uuid
    RETURNING id, amount`;
  const payment = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO payments(booking_id, type, method, amount, status, idempotency_key, paid_at)
      VALUES (${fixture.bookingId}::uuid, 'DEPOSIT', 'BANK_TRANSFER', ${input.paidAmount},
              'SUCCEEDED', ${`hb212-${fixture.bookingId}`}, clock_timestamp())
      RETURNING id`,
    'chứng từ thu',
  );
  // Chia theo nghĩa vụ, phần dư dồn dòng cuối: Σ phân bổ = số đã thu (không thất lạc một đồng).
  const total = charges.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  let left = input.paidAmount;
  for (const [index, charge] of charges.entries()) {
    const slice =
      index === charges.length - 1 ? left : (input.paidAmount * BigInt(charge.amount)) / total;
    if (slice <= 0n) continue;
    left -= slice;
    await db.$executeRaw`
      INSERT INTO payment_allocations(payment_id, charge_id, amount)
      VALUES(${payment.id}::uuid, ${charge.id}::uuid, ${slice})`;
  }
  await db.$executeRaw`
    UPDATE bookings SET paid_amount = ${input.paidAmount}, updated_at = clock_timestamp()
     WHERE id = ${fixture.bookingId}::uuid`;
  return { fixture, paymentId: payment.id };
}

/**
 * Hồ sơ hoàn **thu muộn** đã có trước khi hold hết hạn — mô phỏng đúng đường BR-PAY-11
 * (`event_key = psp-late:<paymentId>`): tiền về khi hold đã quá hạn nhưng job chưa chạy.
 */
export async function seedLateRefund(
  db: PrismaClient,
  input: { readonly bookingId: string; readonly paymentId: string; readonly amount: bigint },
): Promise<string> {
  const request = onlyRow(
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO refund_requests(booking_id, event_key, payment_id, policy_id, hours_before_check_in,
        applied_tier_id, refund_percent, requested_amount, refund_fee, status, is_force_majeure,
        evidence_refs, reason, requested_by, requester_type, requester_id)
      SELECT ${input.bookingId}::uuid, ${`psp-late:${input.paymentId}`},
             ${input.paymentId}::uuid, rp.cancellation_policy_id, 48.00, null, 100, ${input.amount},
             0, 'PENDING', false, '{}'::text[], 'PAYMENT_TIMEOUT', null, 'SYSTEM', 'webhook-psp'
        FROM bookings b JOIN rate_plans rp ON rp.id = b.rate_plan_id
       WHERE b.id = ${input.bookingId}::uuid
      RETURNING id`,
    'hồ sơ thu muộn',
  );
  await db.$executeRaw`
    INSERT INTO refund_allocations(refund_request_id, original_payment_id, amount)
    VALUES(${request.id}::uuid, ${input.paymentId}::uuid, ${input.amount})`;
  return request.id;
}

export interface HoldRefundRow {
  readonly id: string;
  readonly eventKey: string;
  readonly status: string;
  readonly requesterType: string;
  readonly requesterId: string;
  readonly requestedBy: string | null;
  readonly requestedAmount: string;
  readonly refundFee: string;
  readonly netRefund: string;
  readonly refundPercent: string;
  readonly reason: string;
  readonly paymentId: string | null;
  readonly appliedTierId: string | null;
  readonly createdAt: Date;
}

export interface HoldRefundState {
  readonly requests: HoldRefundRow[];
  readonly allocations: { requestId: string; paymentId: string; amount: string }[];
  readonly audit: {
    action: string;
    actorRole: string;
    actorId: string | null;
    requestedAmount: string | null;
  }[];
  readonly outbox: { eventType: string; aggregateType: string; payload: Record<string, unknown> }[];
  readonly charges: { amount: string; voided: string }[];
  readonly allocationsReleased: { amount: string; released: string; reason: string | null }[];
}

/** Trạng thái tiền của một booking sau lượt quét. */
export async function holdRefundState(
  db: PrismaClient,
  bookingId: string,
): Promise<HoldRefundState> {
  const requests = await db.$queryRaw<
    {
      id: string;
      event_key: string;
      status: string;
      requester_type: string;
      requester_id: string;
      requested_by: string | null;
      requested_amount: bigint;
      refund_fee: bigint;
      net_refund: bigint;
      refund_percent: string;
      reason: string;
      payment_id: string | null;
      applied_tier_id: string | null;
      created_at: Date;
    }[]
  >`
    SELECT id, event_key, status, requester_type, requester_id, requested_by, requested_amount,
           refund_fee, net_refund, refund_percent::text AS refund_percent, reason, payment_id,
           applied_tier_id, created_at
      FROM refund_requests WHERE booking_id = ${bookingId}::uuid
     ORDER BY created_at, id`;
  const allocations = await db.$queryRaw<
    { refund_request_id: string; original_payment_id: string; amount: bigint }[]
  >`
    SELECT a.refund_request_id, a.original_payment_id, a.amount
      FROM refund_allocations a
      JOIN refund_requests r ON r.id = a.refund_request_id
     WHERE r.booking_id = ${bookingId}::uuid
     ORDER BY a.original_payment_id`;
  const audit = await db.$queryRaw<
    {
      action: string;
      actor_role: string;
      actor_id: string | null;
      requested_amount: string | null;
    }[]
  >`
    SELECT action, actor_role, actor_id, after_json ->> 'requestedAmount' AS requested_amount
      FROM audit_logs
     WHERE entity_type = 'RefundRequest' AND entity_id = ANY(
       SELECT id FROM refund_requests WHERE booking_id = ${bookingId}::uuid)
     ORDER BY chain_seq`;
  const outbox = await db.$queryRaw<
    { event_type: string; aggregate_type: string; payload_json: Record<string, unknown> }[]
  >`
    SELECT event_type, aggregate_type, payload_json FROM outbox_events
     WHERE aggregate_type = 'RefundRequest' AND aggregate_id = ANY(
       SELECT id FROM refund_requests WHERE booking_id = ${bookingId}::uuid)
     ORDER BY created_at`;
  const charges = await db.$queryRaw<{ amount: bigint; voided_amount: bigint }[]>`
    SELECT amount, voided_amount FROM booking_charges
     WHERE booking_id = ${bookingId}::uuid ORDER BY id`;
  const released = await db.$queryRaw<
    { amount: bigint; released_amount: bigint; release_reason: string | null }[]
  >`
    SELECT a.amount, a.released_amount, a.release_reason
      FROM payment_allocations a
      JOIN booking_charges c ON c.id = a.charge_id
     WHERE c.booking_id = ${bookingId}::uuid
     ORDER BY a.id`;
  return {
    requests: requests.map((row) => ({
      id: row.id,
      eventKey: row.event_key,
      status: row.status,
      requesterType: row.requester_type,
      requesterId: row.requester_id,
      requestedBy: row.requested_by,
      requestedAmount: String(row.requested_amount),
      refundFee: String(row.refund_fee),
      netRefund: String(row.net_refund),
      refundPercent: row.refund_percent,
      reason: row.reason,
      paymentId: row.payment_id,
      appliedTierId: row.applied_tier_id,
      createdAt: row.created_at,
    })),
    allocations: allocations.map((row) => ({
      requestId: row.refund_request_id,
      paymentId: row.original_payment_id,
      amount: String(row.amount),
    })),
    audit: audit.map((row) => ({
      action: row.action,
      actorRole: row.actor_role,
      actorId: row.actor_id,
      requestedAmount: row.requested_amount,
    })),
    outbox: outbox.map((row) => ({
      eventType: row.event_type,
      aggregateType: row.aggregate_type,
      payload: row.payload_json,
    })),
    charges: charges.map((row) => ({
      amount: String(row.amount),
      voided: String(row.voided_amount),
    })),
    allocationsReleased: released.map((row) => ({
      amount: String(row.amount),
      released: String(row.released_amount),
      reason: row.release_reason,
    })),
  };
}
