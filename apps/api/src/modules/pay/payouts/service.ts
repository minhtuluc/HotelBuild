/**
 * HB-100 — chuẩn bị chi hoàn: chỉ hồ sơ `APPROVED`, đúng cơ sở, đúng phương thức gốc (BR-CANCEL-16,
 * BR-PAY-08/09; ADR-016). Lệnh này **không gọi PSP**: nó ghi chứng từ `Payment REFUND PENDING`, operation
 * kỹ thuật READY và khoá PSP bền trong cùng transaction, rồi worker `q.refund-payout` mới chi.
 *
 * Vì sao tách khỏi `pay/refunds`: hợp đồng `/refund-requests/{id}/pay` là tác vụ của ACCOUNTANT và có
 * vòng đời lease/đối soát riêng; module hoàn tiền HB-099 giữ maker–checker, không bị đổi quyền hay mã lỗi.
 */
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { RefundConfirmTransferRequest, RefundPayRequest } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PIN_PURPOSE_FINANCIAL, requirePinToken } from '../../auth/pin/consume.js';
import { BookingLedger } from '../ledger/service.js';
import {
  lockRefund,
  MANUAL_TRANSFER_AWAITING_CONFIRMATION,
  type RefundRow,
} from '../refunds/writes.js';
import { checkIntent, legMethods, payoutError } from './validation.js';
import { payoutView, type RefundPayoutView } from './view.js';
import {
  insertPayoutLeg,
  insertRefundPaidEvent,
  legsOf,
  lockAllocations,
  lockPayoutOperations,
  markPaidIfComplete,
  payoutOperations,
  refundFailure,
  settleTransferLeg,
  syncRefundedAmount,
  type PayoutRow,
  type RefundLegRow,
  type Tx,
} from './writes.js';

/** Leg đã có chứng từ chi nhưng chưa có operation là dữ liệu lệch — đối soát tay, không tạo leg mới. */
function assertNoOrphanLegs(legs: readonly RefundLegRow[]): void {
  if (legs.some((leg) => leg.refund_payment_id !== null))
    throw payoutError('gateway', 'Hồ sơ đã có chứng từ chi chưa gắn thao tác; cần đối soát.');
}

/**
 * HB-215: hồ sơ chờ xác nhận chuyển khoản tay ⇔ có operation và **mọi** leg đang `UNKNOWN` với
 * `last_error = MANUAL_TRANSFER_AWAITING_CONFIRMATION` (worker dừng trước khi chi thật).
 */
function awaitingTransfer(operations: readonly PayoutRow[]): boolean {
  return (
    operations.length > 0 &&
    operations.every(
      (operation) =>
        operation.status === 'UNKNOWN' &&
        operation.last_error === MANUAL_TRANSFER_AWAITING_CONFIRMATION,
    )
  );
}

/**
 * Lệnh gửi lại trên hồ sơ đã chốt: chỉ coi là replay khi **mọi** leg `SUCCEEDED` và cùng
 * `provider_txn_id = bankReference`; mã khác là xung đột (không đổi gì).
 */
function transferReplay(
  row: RefundRow,
  operations: readonly PayoutRow[],
  bankReference: string,
): RefundPayoutView | null {
  if (operations.length === 0) return null;
  const sameReference = operations.every(
    (operation) => operation.status === 'SUCCEEDED' && operation.provider_txn_id === bankReference,
  );
  return sameReference ? payoutView(row.id, row.status, operations) : null;
}

export class PayoutService {
  private readonly ledger: BookingLedger;

  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly audit: AuditWriter,
  ) {
    this.ledger = new BookingLedger(clock);
  }

  /** Cổng `@Idempotent` chạy trước transaction: kiểm phiên, role và phạm vi cơ sở sớm. */
  async authorizeRefundFor(
    db: PrismaClient,
    actor: AuthorizedActor,
    refundRequestId: string,
  ): Promise<void> {
    const found = await db.refund_requests.findUnique({
      where: { id: refundRequestId },
      select: { booking_id: true },
    });
    if (!found) throw payoutError('missing');
    await this.authorize(db, actor, found.booking_id);
  }

  /**
   * Ghi đủ leg cho hồ sơ `APPROVED` rồi trả trạng thái kỹ thuật. Gọi lặp (kể cả khoá chống trùng khác)
   * **không** tạo chứng từ hay khoá PSP thứ hai — UNIQUE `refund_allocation_id`/`refund_payment_id` là
   * hàng rào cuối, còn ở đây trả lại operation đã có để lệnh là idempotent theo nghiệp vụ.
   */
  async pay(
    tx: Tx,
    actor: AuthorizedActor,
    refundRequestId: string,
    input: RefundPayRequest,
  ): Promise<RefundPayoutView> {
    try {
      const found = await tx.refund_requests.findUnique({
        where: { id: refundRequestId },
        select: { booking_id: true },
      });
      if (!found) throw payoutError('missing');
      await this.authorize(tx, actor, found.booking_id);
      // Khoá booking/payments/refund theo đúng thứ tự ADR-014 trước khi gắn chứng từ chi.
      await this.ledger.read(tx, found.booking_id);
      const row = await lockRefund(tx, refundRequestId);
      const existing = await payoutOperations(tx, refundRequestId);
      if (row.status === 'PAID') return payoutView(row.id, row.status, existing);
      if (row.status !== 'APPROVED') throw payoutError('notApproved');
      const legs = await legsOf(tx, refundRequestId);
      const methods = legMethods(legs.map((leg) => leg.original_method));
      checkIntent(input, methods);
      // Một `pinToken` dùng một lần cho toàn bộ lệnh chi (mọi leg) — BR-RBAC-05, api.md §2.6.
      // Tiêu thụ **trước** khi trả lại operation đã có: lệnh 🔒 không được trả số tiền/khoá PSP khi
      // thiếu PIN (replay cùng `Idempotency-Key` do interceptor phục vụ, không vào nhánh này).
      await requirePinToken(tx, {
        userId: actor.id,
        token: input.pinToken,
        purpose: PIN_PURPOSE_FINANCIAL,
        bookingId: row.booking_id,
        now: this.clock.now(),
      });
      const reused = this.existingView(existing);
      if (reused !== null) return reused;
      assertNoOrphanLegs(legs);
      const now = this.clock.now();
      const created: PayoutRow[] = [];
      for (const [index, leg] of legs.entries())
        created.push(
          await insertPayoutLeg(tx, {
            bookingId: row.booking_id,
            refundRequestId: row.id,
            allocationId: leg.id,
            originalPaymentId: leg.original_payment_id,
            method: methods[index]!,
            amount: leg.amount,
            bankNote: input.bankNote?.trim() ?? null,
            actorId: actor.id,
            now,
          }),
        );
      await this.audit.record(tx, {
        actor,
        action: 'REFUND_PAYOUT_STARTED',
        entityType: 'RefundRequest',
        entityId: row.id,
        beforeJson: { status: row.status },
        afterJson: {
          bookingId: row.booking_id,
          status: row.status,
          methods,
          operations: created.map((operation) => ({
            id: operation.id,
            amount: operation.amount.toString(),
            method: operation.method,
            originalPaymentId: operation.original_payment_id,
            refundPaymentId: operation.refund_payment_id,
            pspKey: operation.psp_key,
          })),
        },
        reason: 'Chuẩn bị chi hoàn',
      });
      return payoutView(row.id, row.status, created);
    } catch (error) {
      return refundFailure(error);
    }
  }

  /**
   * HB-215 / api.md §2.6 — kế toán xác nhận **đã chuyển khoản** cho mọi leg đang chờ đối soát.
   *
   * Một transaction, khoá theo ADR-014 (`booking → payments → refund_requests → refund_allocations →
   * refund_payout_operations`): chứng từ chi + operation → `SUCCEEDED` với `provider_txn_id =
   * bankReference`, hồ sơ → `PAID` khi mọi leg xong, đồng bộ `bookings.refunded_amount`, `RefundPaid`
   * ra outbox và `REFUND_TRANSFER_CONFIRMED` vào `audit_logs`. Gửi lại **cùng** mã trả lại đúng view
   * (không sinh chứng từ/audit thứ hai); mã khác là xung đột.
   *
   * Duyệt và xác nhận là hai người (BR-CANCEL-15/16): người duyệt hồ sơ không tự xác nhận đã chi.
   */
  async confirmTransfer(
    tx: Tx,
    actor: AuthorizedActor,
    refundRequestId: string,
    input: RefundConfirmTransferRequest,
  ): Promise<RefundPayoutView> {
    try {
      const found = await tx.refund_requests.findUnique({
        where: { id: refundRequestId },
        select: { booking_id: true },
      });
      if (!found) throw payoutError('missing');
      await this.authorize(tx, actor, found.booking_id);
      await this.ledger.read(tx, found.booking_id);
      const row = await lockRefund(tx, refundRequestId);
      await lockAllocations(tx, refundRequestId);
      const existing = await lockPayoutOperations(tx, refundRequestId);
      if (row.approved_by !== null && row.approved_by === actor.id)
        throw payoutError('selfApproval', 'Người duyệt hồ sơ không được tự xác nhận đã chi.');
      // PIN tiêu thụ **trước** khi trả kết quả replay: lệnh 🔒 không được trả trạng thái chi khi
      // thiếu PIN (cùng luật với `pay`; replay cùng `Idempotency-Key` do interceptor phục vụ).
      await requirePinToken(tx, {
        userId: actor.id,
        token: input.pinToken,
        purpose: PIN_PURPOSE_FINANCIAL,
        bookingId: row.booking_id,
        now: this.clock.now(),
      });
      const replayed = transferReplay(row, existing, input.bankReference);
      if (replayed !== null) return replayed;
      if (row.status !== 'APPROVED' || !awaitingTransfer(existing)) throw payoutError('notPending');
      const now = this.clock.now();
      for (const operation of existing)
        await settleTransferLeg(tx, operation, input.bankReference, now);
      const status = await markPaidIfComplete(tx, row.id, now);
      await syncRefundedAmount(tx, row.booking_id, now);
      if (status === 'PAID') await insertRefundPaidEvent(tx, row.id, row.booking_id, now);
      await this.audit.record(tx, {
        actor,
        action: 'REFUND_TRANSFER_CONFIRMED',
        entityType: 'RefundRequest',
        entityId: row.id,
        beforeJson: { status: row.status },
        afterJson: {
          bookingId: row.booking_id,
          status,
          // Chỉ mã tham chiếu + chứng từ kỹ thuật; KHÔNG số tài khoản thô, `bankNote` hay `pinToken`.
          bankReference: input.bankReference,
          operations: existing.map((operation) => ({
            operationId: operation.id,
            amount: operation.amount.toString(),
            method: operation.method,
          })),
        },
        reason: 'Kế toán xác nhận đã chuyển khoản hoàn tiền',
      });
      return payoutView(row.id, status, await payoutOperations(tx, row.id));
    } catch (error) {
      return refundFailure(error);
    }
  }

  /**
   * Lệnh đã tạo leg trước đó: trả lại trạng thái kỹ thuật, **không** sinh chứng từ/khoá thứ hai. Chỉ
   * khi một leg đã `FAILED_FINAL` mới từ chối để kế toán đối soát tay (api.md §2.6).
   */
  private existingView(rows: readonly PayoutRow[]): RefundPayoutView | null {
    if (rows.length === 0) return null;
    if (rows.some((operation) => operation.status === 'FAILED_FINAL')) throw payoutError('gateway');
    return payoutView(rows[0]!.refund_request_id, 'APPROVED', rows);
  }

  /**
   * Phiên còn hiệu lực và còn phạm vi cơ sở của booking (BR-RBAC-02, OWNER toàn chuỗi). Cùng phép kiểm
   * với `RefundService.authorize` — hàm đó private và module giữ ranh giới, nên bản này giữ đúng SQL/luật.
   */
  private async authorize(
    tx: Tx | PrismaClient,
    actor: AuthorizedActor,
    bookingId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id}::uuid FOR SHARE`;
    const user = await tx.users.findUnique({
      where: { id: actor.id },
      select: {
        role: true,
        is_active: true,
        user_property_scopes: { select: { property_id: true } },
      },
    });
    if (!user?.is_active || user.role !== actor.role)
      throw payoutError('forbidden', 'Phiên làm việc đã thay đổi.');
    const booking = await tx.bookings.findUnique({
      where: { id: bookingId },
      select: { property_id: true },
    });
    if (!booking) throw payoutError('missing');
    const scoped =
      user.role === 'OWNER' ||
      user.user_property_scopes.some((scope) => scope.property_id === booking.property_id);
    if (!scoped) throw payoutError('forbidden', 'Hồ sơ ngoài phạm vi cơ sở.');
  }
}
