/**
 * HB-212 — hết hạn giữ chỗ khi PSP **đã thu tiền** (F5-QA-01): không được để `EXPIRED` + `paid_amount > 0`
 * mà thiếu hồ sơ hoàn.
 *
 * Cùng một transaction với bước chuyển `EXPIRED` (BR-BOOK-18; QĐ-05 §1 "hoàn **đúng số đã thu**"; QĐ-07
 * mục 2), hàm ở đây làm đúng ba việc tiền:
 * 1. **Nhả phân bổ** tiền đã thu khỏi nghĩa vụ và void nghĩa vụ phòng (`booking_charges` ROOM) — cùng hình
 *    dạng với `voidRoomCharges` của đường huỷ (`book/cancel/writes.ts`), vì booking hết hạn không còn
 *    nghĩa vụ nào (BR-PAY-02: "EXPIRED theo BR-BOOK-18 không có phạt") và nguồn thu phải **khả dụng** để
 *    giữ hạn mức hoàn (BR-CANCEL-17: giữ đủ theo từng Payment gốc).
 * 2. Lập **đúng một** `RefundRequest` PENDING hoàn 100% phần tiền **còn lại** (chưa bị hồ sơ khác giữ/chi),
 *    `requested_by = NULL` + `requester_type = SYSTEM` (ràng buộc `ck_refund_requester`), **không** áp bậc
 *    phí huỷ và **không** làm tròn (BR-GEN-03 ngoại lệ BR-BOOK-18; BR-BOOK-18 "hoàn toàn bộ, miễn phí/
 *    phạt khi hết hạn"). Hình dạng bản ghi bám đúng `requestRefund` của BR-PAY-11
 *    (`pay/webhooks/apply.ts`): reason `PAYMENT_TIMEOUT`, `refund_percent = 100`, `refund_fee = 0`.
 * 3. Ghi `refund_allocations` (giữ hạn mức theo BR-CANCEL-17) + `audit_logs` + `outbox_events` trong cùng
 *    transaction. Hồ sơ **không** tự duyệt: nó đi qua maker–checker như mọi hồ sơ (BR-CANCEL-15), ngưỡng
 *    lớn (`deal.threshold.minor`) do tầng duyệt của API áp.
 *
 * Chống trùng **tất định**, không thêm bảng/cột: transaction đã khoá `bookings` trước (ADR-014) nên chỉ
 * một lượt chạy vào được; trong transaction kiểm `refund_requests.event_key = 'hold-expiry'` rồi mới ghi,
 * và ràng buộc sẵn có `uq_refund_event UNIQUE (booking_id, event_key)` là lưới an toàn cuối (INSERT dùng
 * `ON CONFLICT DO NOTHING`). Nhờ vậy chạy lại job — cùng hay khác tiến trình — không sinh hồ sơ thứ hai.
 *
 * Không tự ghi sổ ở đây: `paid_amount` là tổng thu SUCCEEDED (BR-PAY-02) nên **không** đổi khi lập hoàn;
 * `refunded_amount` chỉ tăng khi hồ sơ `PAID` (worker `refund-payout/settle.ts`).
 */
import type { Prisma } from '@prisma/client';
import { currentTraceFields } from '../../tracing/trace-context.js';

type Tx = Prisma.TransactionClient;

/** Khoá sự kiện ổn định theo booking: cùng booking + cùng nguyên nhân ⇒ cùng một hồ sơ. */
export const HOLD_REFUND_EVENT_KEY = 'hold-expiry';

/** Cùng bộ mã với BR-PAY-11 (tiền đến khi hold đã hết hiệu lực) và ràng buộc `reason` của CSDL. */
export const HOLD_REFUND_REASON = 'PAYMENT_TIMEOUT';

/** `requester_id` của người lập SYSTEM — không phải `users.id` nên không thể trùng người duyệt. */
export const HOLD_REFUND_REQUESTER = 'hold-expiry';

export const HOLD_REFUND_AUDIT_ACTION = 'REFUND_REQUESTED';
export const HOLD_REFUND_OUTBOX_EVENT = 'RefundRequested';
export const HOLD_REFUND_NOTE = 'Hoàn tiền giữ chỗ hết hạn';

/** Nhãn nhả phân bổ/nghĩa vụ — cùng bộ mã với `room_assignments.release_reason` của HB-078. */
const RELEASE_REASON = 'HOLD_EXPIRED';

/** BR-PAY-02: chỉ các loại này là **thu**; `REFUND`/`COMPENSATION` là chi ra, không hoàn lại. */
const COLLECTION_TYPES = ['DEPOSIT', 'BALANCE', 'PENALTY', 'EXTRA_SERVICE', 'RESCHEDULE_FEE'];

interface ReceiptRow {
  readonly id: string;
  readonly amount: bigint;
}

interface ReservationRow {
  readonly payment_id: string;
  readonly amount: bigint;
}

interface RequestRow {
  readonly id: string;
  readonly net_refund: bigint | null;
}

interface RefundLeg {
  readonly paymentId: string;
  readonly amount: bigint;
}

export interface SettledRefund {
  /** `null` = lượt này **không** lập hồ sơ mới (không có tiền, đã có hồ sơ, hoặc tiền đã được giữ hết). */
  readonly refundRequestId: string | null;
  /** Tổng số tiền của hồ sơ vừa lập (VND nguyên); `0n` khi không lập. */
  readonly requestedAmount: bigint;
  readonly releasedAllocations: number;
  readonly voidedCharges: number;
}

export interface HoldMoneyFacts {
  readonly id: string;
  readonly check_in: Date;
  readonly rate_plan_id: string;
}

/** Ghi lỗi có **mã** để log an toàn của lượt quét (`safeErrorCode`) không rơi về `UNKNOWN`. */
function refundError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

const NOTHING: SettledRefund = {
  refundRequestId: null,
  requestedAmount: 0n,
  releasedAllocations: 0,
  voidedCharges: 0,
};

interface LockedMoney {
  readonly receipts: ReceiptRow[];
  readonly reservations: ReservationRow[];
}

/**
 * Khoá và đọc dữ liệu tiền theo ADR-014: payments → charges → allocations → refunds (booking đã bị caller
 * khoá trước). `null` = không có chứng từ thu, hoặc đã có hồ sơ hết hạn (chống trùng tất định).
 */
async function lockMoney(tx: Tx, bookingId: string): Promise<LockedMoney | null> {
  const receipts = await tx.$queryRaw<ReceiptRow[]>`
    SELECT id, amount FROM payments
     WHERE booking_id = ${bookingId}::uuid AND status = 'SUCCEEDED'
       AND type = ANY(${[...COLLECTION_TYPES]}::text[])
     ORDER BY id FOR UPDATE`;
  if (receipts.length === 0) return null;
  await tx.$queryRaw`
    SELECT id FROM booking_charges WHERE booking_id = ${bookingId}::uuid ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`
    SELECT a.id FROM payment_allocations a
      JOIN booking_charges c ON c.id = a.charge_id
     WHERE c.booking_id = ${bookingId}::uuid
     ORDER BY a.id FOR UPDATE OF a`;
  await tx.$queryRaw`
    SELECT id FROM refund_requests WHERE booking_id = ${bookingId}::uuid ORDER BY id FOR UPDATE`;
  const existing = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM refund_requests
     WHERE booking_id = ${bookingId}::uuid AND event_key = ${HOLD_REFUND_EVENT_KEY}`;
  if (existing.length > 0) return null;
  // Tiền đã được hồ sơ khác giữ/chi (vd. khoản thu muộn `psp-late:<paymentId>` của BR-PAY-11) thì không
  // lập hồ sơ thứ hai cho cùng khoản đó — cộng dồn theo từng Payment vẫn ≤ số đã thu (BR-CANCEL-17).
  const reservations = await tx.$queryRaw<ReservationRow[]>`
    SELECT a.original_payment_id AS payment_id, sum(a.amount)::bigint AS amount
      FROM refund_allocations a
      JOIN refund_requests r ON r.id = a.refund_request_id
     WHERE r.booking_id = ${bookingId}::uuid AND r.status IN ('PENDING','APPROVED','PAID')
     GROUP BY 1`;
  return { receipts, reservations };
}

/** Nhả phân bổ tiền + void nghĩa vụ phòng: toàn bộ tiền đã thu trở lại nguồn (như `voidRoomCharges`). */
async function releaseMoney(
  tx: Tx,
  bookingId: string,
  now: Date,
): Promise<{ releasedAllocations: number; voidedCharges: number }> {
  const releasedAllocations = await tx.$executeRaw`
    UPDATE payment_allocations
       SET released_amount = amount, release_reason = ${RELEASE_REASON},
           updated_at = ${now}::timestamptz
     WHERE released_amount < amount
       AND charge_id IN (SELECT id FROM booking_charges WHERE booking_id = ${bookingId}::uuid)`;
  const voidedCharges = await tx.$executeRaw`
    UPDATE booking_charges
       SET voided_amount = amount, reason = coalesce(reason, ${RELEASE_REASON}),
           updated_at = ${now}::timestamptz
     WHERE voided_amount < amount AND booking_id = ${bookingId}::uuid AND kind = 'ROOM'`;
  return { releasedAllocations, voidedCharges };
}

/** Phần tiền còn phải hoàn của từng nguồn thu: đã thu trừ phần hồ sơ khác đang giữ/đã chi. */
function refundLegs(
  receipts: readonly ReceiptRow[],
  reservations: readonly ReservationRow[],
): RefundLeg[] {
  const held = new Map(reservations.map((row) => [row.payment_id, BigInt(row.amount)]));
  return (
    receipts
      .map((receipt) => {
        const reserved = held.get(receipt.id) ?? 0n;
        const amount = BigInt(receipt.amount);
        return { paymentId: receipt.id, amount: amount > reserved ? amount - reserved : 0n };
      })
      .filter((leg) => leg.amount > 0n)
      // Thứ tự UUID tăng dần — cùng quy ước với `BookingLedger.reserve` (khoá nguồn ổn định).
      .sort((left, right) => (left.paymentId < right.paymentId ? -1 : 1))
  );
}

/**
 * Lập hồ sơ PENDING + giữ hạn mức. Chính sách chỉ là tham chiếu bắt buộc của CSDL (`policy_id NOT NULL`);
 * số tiền **không** đi qua bậc huỷ: booking chưa xác nhận hoàn đúng số đã thu nên hồ sơ mang
 * `applied_tier_id = NULL` (token PRECONFIRMATION ở hợp đồng đọc) và `refund_percent = 100`.
 * `null` = thua `ON CONFLICT` (tiến trình khác vừa lập).
 */
async function insertRequest(
  tx: Tx,
  booking: HoldMoneyFacts,
  now: Date,
  legs: readonly RefundLeg[],
  total: bigint,
): Promise<RequestRow | null> {
  const plans = await tx.$queryRaw<{ policy_id: string }[]>`
    SELECT cancellation_policy_id AS policy_id FROM rate_plans
     WHERE id = ${booking.rate_plan_id}::uuid`;
  const policyId = plans[0]?.policy_id;
  if (policyId === undefined) throw refundError('HOLD_REFUND_POLICY');
  const hours = (booking.check_in.getTime() - now.getTime()) / 3_600_000;
  const inserted = await tx.$queryRaw<RequestRow[]>`
    INSERT INTO refund_requests(booking_id, event_key, payment_id, policy_id, hours_before_check_in,
      applied_tier_id, refund_percent, requested_amount, refund_fee, status, is_force_majeure,
      evidence_refs, reason, requested_by, requester_type, requester_id, created_at, updated_at)
    VALUES(${booking.id}::uuid, ${HOLD_REFUND_EVENT_KEY},
      ${legs.length === 1 ? legs[0]!.paymentId : null}::uuid, ${policyId}::uuid,
      ${hours.toFixed(2)}::numeric, null, ${100}::numeric, ${total}, 0::bigint, 'PENDING', false,
      '{}'::text[], ${HOLD_REFUND_REASON}, null, 'SYSTEM', ${HOLD_REFUND_REQUESTER},
      ${now}::timestamptz, ${now}::timestamptz)
    ON CONFLICT (booking_id, event_key) DO NOTHING
    RETURNING id, net_refund`;
  return inserted[0] ?? null;
}

/** Audit + outbox của hồ sơ, cùng transaction (BR-GEN-07; trace của lượt quét — HB-181 review P2). */
async function recordRequest(
  tx: Tx,
  booking: HoldMoneyFacts,
  requestId: string,
  legs: readonly RefundLeg[],
  total: bigint,
  now: Date,
): Promise<void> {
  const after = {
    bookingId: booking.id,
    status: 'PENDING',
    requestedAmount: total.toString(),
    refundPercent: 100,
    refundFee: '0',
    reason: HOLD_REFUND_REASON,
    requesterType: 'SYSTEM',
    requesterId: HOLD_REFUND_REQUESTER,
    allocations: legs.map((leg) => ({ paymentId: leg.paymentId, amount: leg.amount.toString() })),
  };
  await tx.$executeRaw`
    INSERT INTO audit_logs(chain_seq, actor_id, actor_role, action, entity_type, entity_id,
                           before_json, after_json, reason, row_hash, at)
    VALUES (0, null, 'SYSTEM', ${HOLD_REFUND_AUDIT_ACTION}, 'RefundRequest', ${requestId}::uuid,
            null::jsonb, ${JSON.stringify(after)}::jsonb, ${HOLD_REFUND_NOTE},
            'pending-database-trigger', ${now}::timestamptz)`;
  const trace = currentTraceFields();
  await tx.outbox_events.create({
    data: {
      event_type: HOLD_REFUND_OUTBOX_EVENT,
      aggregate_type: 'RefundRequest',
      aggregate_id: requestId,
      payload_json: {
        ...after,
        refundRequestId: requestId,
        ...(trace === null
          ? {}
          : {
              traceparent: trace.traceparent,
              ...(trace.correlationId === null ? {} : { correlationId: trace.correlationId }),
            }),
      },
    },
  });
}

/**
 * Hoàn **đúng phần tiền đã thu còn lại** của một booking vừa hết hạn, trong transaction của caller.
 * Thứ tự khoá theo ADR-014: booking (caller đã khoá) → payments → charges → allocations → refunds.
 */
export async function settleCollectedMoney(
  tx: Tx,
  booking: HoldMoneyFacts,
  now: Date,
): Promise<SettledRefund> {
  const money = await lockMoney(tx, booking.id);
  if (money === null) return NOTHING;
  const { releasedAllocations, voidedCharges } = await releaseMoney(tx, booking.id, now);
  const legs = refundLegs(money.receipts, money.reservations);
  const total = legs.reduce((sum, leg) => sum + leg.amount, 0n);
  const released = { ...NOTHING, releasedAllocations, voidedCharges };
  if (total === 0n) return released;
  const request = await insertRequest(tx, booking, now, legs, total);
  // Thua đua tranh (tiến trình khác vừa lập) ⇒ không ghi gì thêm; lượt sau thấy trạng thái đã đổi.
  if (request === null) return released;
  if (request.net_refund === null || BigInt(request.net_refund) !== total)
    throw refundError('HOLD_REFUND_NET');
  for (const leg of legs) {
    await tx.$executeRaw`
      INSERT INTO refund_allocations(refund_request_id, original_payment_id, amount, created_at,
                                     updated_at)
      VALUES(${request.id}::uuid, ${leg.paymentId}::uuid, ${leg.amount},
             ${now}::timestamptz, ${now}::timestamptz)`;
  }
  await recordRequest(tx, booking, request.id, legs, total, now);
  return { ...released, refundRequestId: request.id, requestedAmount: total };
}
