/**
 * Áp một sự kiện PSP **đã xác minh** vào sổ tiền (ADR-017 §4; BR-PAY-03/09/11) — chạy trong
 * transaction do người gọi mở, khoá theo đúng thứ tự dùng chung của `pay/ledger` (HB-093):
 * booking → payments → refund_requests.
 *
 * Bất biến:
 * - **Kết quả chỉ tăng dần**: `PENDING → FAILED` (ghi nhận từ chối, không di chuyển tiền) và
 *   `PENDING/FAILED → SUCCEEDED` (BR-PAY-11: một giao dịch PSP chỉ cộng tiền một lần, kể cả trước đó
 *   FAILED do timeout cục bộ). Trạng thái `SUCCEEDED` **không bao giờ** bị một sự kiện sau đó hạ xuống.
 * - Nhận tiền **không đổi trạng thái booking** theo cả hai hướng: hold hết hiệu lực (BR-BOOK-18: dù
 *   job HB-078 chưa chạy) hoặc booking đã kết thúc ⇒ không hạ, không xác nhận lại, không tái chiếm
 *   phòng; lập yêu cầu hoàn **100% riêng khoản thu muộn**, miễn phí/phạt, reason `PAYMENT_TIMEOUT`,
 *   requester `SYSTEM` (BR-PAY-11) và giữ hạn mức hoàn trong sổ qua `BookingLedger.reserve`.
 * - Booking đang chờ còn hạn: phân bổ khoản thu vào các nghĩa vụ còn thiếu rồi đồng bộ projection
 *   (`BookingLedger.sync`); việc xác nhận (BR-BOOK-09) vẫn là use case riêng, không nằm ở webhook.
 *
 * Lữ khách/PSP không có `ActorContext` của nhân viên: mọi bản audit mang actor `SYSTEM` kèm mã
 * tương quan của callback (BR-GEN-07), snapshot chỉ có mã/tiền/trạng thái — không thẻ, không PII
 * (BR-PAY-04).
 */
import type { Prisma } from '@prisma/client';
import type { ActorContext } from '../../../common/actor/actor-context.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { BookingLedger } from '../ledger/service.js';
import { loadLocked } from '../ledger/load.js';
import { planReceiptAllocation } from '../ledger/receipt-allocation.js';
import type { ReceiptCharge } from '../ledger/receipt-allocation.js';
import type { PspMethod } from '../psp/port.js';
import type { CallbackDecision } from './contract.js';

export interface VerifiedEvent {
  readonly method: PspMethod;
  /** Khoá sự kiện của `webhook_inbox` — ghi vào audit để "mỗi sự kiện" truy được hàng inbox. */
  readonly eventId: string;
  /** `orderRef` của cổng = `payments.idempotency_key` đã lưu lúc khởi tạo (BR-PAY-03). */
  readonly orderRef: string;
  readonly providerTxnId: string | null;
  readonly amount: bigint;
  readonly outcome: 'SUCCEEDED' | 'FAILED';
  readonly paidAt: Date | null;
  readonly now: Date;
  readonly actor: ActorContext;
}

export interface ApplyOutcome {
  readonly decision: CallbackDecision;
  /** `null` = đóng inbox bằng `PROCESSED`; ngược lại đây là mã lý do ghi vào `last_error`. */
  readonly note: { readonly reason: string; readonly terminal: boolean } | null;
}

/** Thứ tự phân bổ của khoản thu trực tuyến: tiền phòng trước, rồi phạt → dịch vụ → phí đổi (BR-PAY-02). */
const RECEIPT_ALLOCATION_ORDER = ['ROOM', 'PENALTY', 'EXTRA_SERVICE', 'RESCHEDULE_FEE'] as const;

/** Booking đã kết thúc: tiền thu muộn phải hoàn, giữ trạng thái kết thúc (BR-PAY-11). */
const CLOSED: Readonly<Record<string, true>> = {
  CANCELLED: true,
  NO_SHOW: true,
  EXPIRED: true,
};

/** Giai đoạn đang chờ: hold hết hiệu lực (`now ≥ hold_expires_at`) thì coi như đã quá hạn (BR-BOOK-18). */
const WAITING: Readonly<Record<string, true>> = { HELD: true, PENDING_PAYMENT: true };

interface BookingFacts {
  readonly id: string;
  readonly status: string;
  readonly hold_expires_at: Date | null;
  readonly check_in: Date;
  readonly rate_plan_id: string;
}

/** Liên thông hai net nghiệp vụ của một webhook: đóng inbox cùng transaction với sổ tiền. */
export async function applyVerifiedEvent(
  tx: Prisma.TransactionClient,
  ledger: BookingLedger,
  audit: AuditWriter,
  event: VerifiedEvent,
): Promise<ApplyOutcome> {
  const payment = await tx.payments.findFirst({
    where: { idempotency_key: event.orderRef, method: event.method },
    select: { id: true, booking_id: true },
  });
  if (!payment)
    return {
      decision: 'ORDER_UNKNOWN',
      note: { reason: 'ORDER_UNKNOWN', terminal: true },
    };
  // Chiều cao khoá (booking FOR UPDATE ...) này là của HB-093 (loadLocked); webhook không tự phá.
  const facts = await loadLocked(tx, payment.booking_id);
  const locked = facts.payments.find((row) => row.id === payment.id);
  if (!locked || locked.amount !== event.amount)
    return {
      decision: 'AMOUNT_MISMATCH',
      note: { reason: 'AMOUNT_MISMATCH', terminal: true },
    };
  const row = await tx.payments.findUniqueOrThrow({
    where: { id: payment.id },
    select: { provider_txn_id: true },
  });
  const booking = await tx.bookings.findUniqueOrThrow({
    where: { id: payment.booking_id },
    select: {
      id: true,
      status: true,
      hold_expires_at: true,
      check_in: true,
      rate_plan_id: true,
    },
  });
  // Mốc quyết định lấy từ **giờ CSDL** (BR-BOOK-18, ADR-014) vì `hold_expires_at` do CSDL ghi: không
  // được nhận tiền để xác nhận một hold đã hết hiệu lực chỉ vì đồng hồ tiến trình lệch.
  const dbNow = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
  const applied: VerifiedEvent = { ...event, now: dbNow };
  if (applied.outcome === 'FAILED')
    return await applyDecline(tx, audit, applied, payment.id, locked.status, row.provider_txn_id);
  return await applySuccess(
    tx,
    ledger,
    audit,
    applied,
    payment.id,
    payment.booking_id,
    locked.status,
    row.provider_txn_id,
    booking,
  );
}

/** Sự kiện từ chối: `PENDING → FAILED` được ghi một lần; mọi trường hợp khác không hạ kết quả cũ. */
async function applyDecline(
  tx: Prisma.TransactionClient,
  audit: AuditWriter,
  event: VerifiedEvent,
  paymentId: string,
  status: string,
  providerTxnId: string | null,
): Promise<ApplyOutcome> {
  if (status === 'PENDING') {
    await tx.payments.update({
      where: { id: paymentId },
      data: { status: 'FAILED', updated_at: event.now },
    });
    await recordEvent(tx, audit, event, paymentId, 'PAYMENT_DECLINED', providerTxnId, 'FAILED');
    return { decision: 'APPLIED', note: null };
  }
  const action = status === 'FAILED' ? 'PAYMENT_DECLINE_REPLAYED' : 'PAYMENT_STALE_DECLINE';
  await recordEvent(tx, audit, event, paymentId, action, providerTxnId, status);
  return { decision: 'DUPLICATE', note: null };
}

/** Thu thành công: đúng một lần, nếu tiền muộn thì lập nghĩa vụ hoàn, ngược lại phân bổ vào nghĩa vụ. */
async function applySuccess(
  tx: Prisma.TransactionClient,
  ledger: BookingLedger,
  audit: AuditWriter,
  event: VerifiedEvent,
  paymentId: string,
  bookingId: string,
  status: string,
  providerTxnId: string | null,
  booking: BookingFacts,
): Promise<ApplyOutcome> {
  if (status === 'SUCCEEDED') {
    const action =
      providerTxnId === event.providerTxnId ? 'PAYMENT_REPLAYED' : 'PAYMENT_DUPLICATE_CHARGE';
    await recordEvent(tx, audit, event, paymentId, action, providerTxnId, 'SUCCEEDED');
    return {
      decision: providerTxnId === event.providerTxnId ? 'DUPLICATE' : 'RECONCILE',
      note:
        providerTxnId === event.providerTxnId
          ? null
          : { reason: 'DUPLICATE_CHARGE', terminal: true },
    };
  }
  // Thu thành công đúng **một** lần; UNIQUE `(method, provider_txn_id)` đã gắn cho Payment khác thì
  // phải đối soát, không cộng tiền (kiểm lên trước: bắt lỗi UNIQUE giữa transaction sẽ làm hỏng TX).
  if (await reusedTxn(tx, event.method, event.providerTxnId, paymentId)) {
    await recordEvent(
      tx,
      audit,
      event,
      paymentId,
      'PAYMENT_DUPLICATE_CHARGE',
      providerTxnId,
      status,
    );
    return {
      decision: 'RECONCILE',
      note: { reason: 'PROVIDER_TXN_REUSED', terminal: true },
    };
  }
  await tx.payments.update({
    where: { id: paymentId },
    data: {
      status: 'SUCCEEDED',
      provider_txn_id: event.providerTxnId,
      paid_at: event.paidAt ?? event.now,
      updated_at: event.now,
    },
  });
  // BR-PAY-11: hold hết hiệu lực hoặc booking kết thúc ⇒ giữ trạng thái, hoàn 100% khoản thu muộn.
  if (isLateReceipt(booking, event.now)) {
    await requestRefund(tx, ledger, event, paymentId, bookingId, booking);
    await recordEvent(
      tx,
      audit,
      event,
      paymentId,
      'PAYMENT_LATE_OBLIGATION',
      event.providerTxnId,
      'SUCCEEDED',
    );
    return { decision: 'APPLIED', note: null };
  }
  await allocateReceipt(tx, event, paymentId, bookingId);
  await ledger.sync(tx, bookingId, event.actor);
  await recordEvent(
    tx,
    audit,
    event,
    paymentId,
    'PAYMENT_APPLIED',
    event.providerTxnId,
    'SUCCEEDED',
  );
  return { decision: 'APPLIED', note: null };
}

/** Tiền thu muộn (BR-PAY-11): booking đã kết thúc, hoặc đang chờ mà hold hết hiệu lực theo giờ CSDL. */
function isLateReceipt(booking: BookingFacts, now: Date): boolean {
  if (CLOSED[booking.status] === true) return true;
  return (
    WAITING[booking.status] === true &&
    booking.hold_expires_at !== null &&
    booking.hold_expires_at <= now
  );
}

/** `UNIQUE (method, provider_txn_id)`: mã giao dịch đã gắn cho Payment khác ⇒ phải đối soát tay. */
async function reusedTxn(
  tx: Prisma.TransactionClient,
  method: PspMethod,
  providerTxnId: string | null,
  paymentId: string,
): Promise<boolean> {
  if (providerTxnId === null) return false;
  const clash = await tx.payments.findFirst({
    where: { method, provider_txn_id: providerTxnId, id: { not: paymentId } },
    select: { id: true },
  });
  return clash !== null;
}

/** Nghĩa vụ hoàn cho khoản thu muộn: 100%, miễn phí/phạt, khoá `event_key` tránh lập lần hai. */
async function requestRefund(
  tx: Prisma.TransactionClient,
  ledger: BookingLedger,
  event: VerifiedEvent,
  paymentId: string,
  bookingId: string,
  booking: BookingFacts,
): Promise<void> {
  const plan = await tx.rate_plans.findUniqueOrThrow({
    where: { id: booking.rate_plan_id },
    select: { cancellation_policy_id: true },
  });
  const hours = (booking.check_in.getTime() - event.now.getTime()) / 3_600_000;
  const request = await tx.refund_requests.create({
    data: {
      booking_id: bookingId,
      event_key: `psp-late:${paymentId}`,
      payment_id: paymentId,
      policy_id: plan.cancellation_policy_id,
      hours_before_check_in: hours.toFixed(2),
      refund_percent: '100',
      requested_amount: event.amount,
      reason: 'PAYMENT_TIMEOUT',
      requester_type: 'SYSTEM',
      requester_id: 'webhook-psp',
      status: 'PENDING',
      created_at: event.now,
      updated_at: event.now,
    },
    select: { id: true },
  });
  // Giữ hạn mức hoàn trong sổ: khoản thu muộn không bị phân bổ cho nghĩa vụ nào khác (BR-CANCEL-17).
  await ledger.reserve(
    tx,
    bookingId,
    request.id,
    [{ paymentId, amount: event.amount }],
    event.actor,
  );
}

/**
 * Phân bổ khoản thu theo **trọng số phòng** (BR-CANCEL-19, HB-211) bằng allocator chung của sổ tiền.
 * `applyVerifiedEvent` đã khoá booking → payments (ADR-014) trước khi tới đây nên đọc rồi ghi trong cùng
 * transaction là an toàn. Chỉ ghi khi còn nghĩa vụ (`amount − voided − đã phân bổ còn hiệu lực`), nên
 * khoản thu không bao giờ vượt nghĩa vụ của một dòng phí và không đụng các phân bổ đã ghi.
 */
async function allocateReceipt(
  tx: Prisma.TransactionClient,
  event: VerifiedEvent,
  paymentId: string,
  bookingId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<
    { id: string; kind: string; room_id: string | null; amount: bigint; outstanding: bigint }[]
  >`
    SELECT c.id,
           c.kind,
           c.booking_room_id AS room_id,
           c.amount,
           ((c.amount - c.voided_amount) - COALESCE(SUM(a.amount - a.released_amount), 0))::bigint AS outstanding
      FROM booking_charges c
      LEFT JOIN payment_allocations a ON a.charge_id = c.id
     WHERE c.booking_id = ${bookingId}::uuid
     GROUP BY c.id, c.kind, c.booking_room_id, c.amount
     ORDER BY c.id`;
  const charges: readonly ReceiptCharge[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    roomId: row.room_id,
    weight: row.amount,
    outstanding: row.outstanding,
  }));
  const lines = planReceiptAllocation(event.amount, charges, RECEIPT_ALLOCATION_ORDER);
  if (!lines.length) return;
  await tx.payment_allocations.createMany({
    data: lines.map((line) => ({
      payment_id: paymentId,
      charge_id: line.chargeId,
      amount: line.amount,
      created_at: event.now,
      updated_at: event.now,
    })),
  });
}

/** Vết audit cho **từng** sự kiện (event canonical, provider, trạng thái, kết quả); không PII. */
async function recordEvent(
  tx: Prisma.TransactionClient,
  audit: AuditWriter,
  event: VerifiedEvent,
  paymentId: string,
  action: string,
  providerTxnId: string | null,
  status: string,
): Promise<void> {
  await audit.record(tx, {
    actor: event.actor,
    action,
    entityType: 'Payment',
    entityId: paymentId,
    beforeJson: null,
    afterJson: {
      provider: event.method,
      eventId: event.eventId,
      providerTxnId,
      orderRef: event.orderRef,
      amount: event.amount.toString(),
      outcome: event.outcome,
      status,
    },
    reason: 'PSP webhook verified and applied',
  });
}
