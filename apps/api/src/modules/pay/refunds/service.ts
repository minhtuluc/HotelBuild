/**
 * HB-099 — maker–checker hoàn tiền: lập / duyệt / từ chối / rút hồ sơ `RefundRequest`.
 * Quyền hoàn (GROSS) do engine chính sách huỷ (`book/cancel`, HB-053/097) tính; sổ tiền và hạn mức
 * NET do `BookingLedger` (HB-093) giữ từ trạng thái PENDING. Tầng này **không tự tính tiền**.
 */
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { refundDecisionSchema } from '@pinehill/contracts';
import type {
  RefundDecision,
  RefundRequest,
  RefundRequestCreateRequest,
} from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PIN_PURPOSE_FINANCIAL, requirePinToken } from '../../auth/pin/consume.js';
import { readFacts, type CancelFacts } from '../../book/cancel/context.js';
import { decide } from '../../book/cancel/engine.js';
import { BookingLedger } from '../ledger/service.js';
import { approveInput, cancelInput, refundError, rejectInput } from './validation.js';
import { payoutDeadline, requestView, vnd } from './view.js';
import {
  auditLogId,
  eventKeyOf,
  insertRequest,
  lockRefund,
  reallocate,
  recordDecision,
  refundFailure,
  settlementNet,
  thresholdAmount,
  withdraw,
  type RefundRow,
  type Tx,
} from './writes.js';

const engineStates = ['HELD', 'PENDING_PAYMENT', 'CONFIRMED'] as const;
/** BR-CANCEL-13/15: người quyết là MANAGER/OWNER, khác người lập, ở mọi mức tiền. */
const deciders = ['MANAGER', 'OWNER'];
const forceMajeureNote = 20;

/** BR-CANCEL-19: hoàn áp cho toàn bộ phòng đang hoạt động (thân lệnh không nhận tập phòng). */
function activeRooms(facts: CancelFacts): string[] {
  return facts.rooms.filter((room) => room.active).map((room) => room.roomId);
}

/** `refund_approvals.reason` cấm chuỗi rỗng nên `note` trắng cũng phải có giá trị dự phòng. */
function decisionNote(note: string | undefined, fallback: string): string {
  const text = (note ?? '').trim();
  return text.length > 0 ? text : fallback;
}

/** Số duyệt hợp lệ: dương, ≤ số yêu cầu và còn NET dương sau phí; trả NET cho phần giữ hạn mức. */
function approvedLegs(
  row: RefundRow,
  input: { approvedAmount: number },
): { gross: bigint; net: bigint } | null {
  const gross = BigInt(input.approvedAmount);
  if (gross <= 0n || gross > row.requested_amount) return null;
  const net = gross > row.refund_fee ? gross - row.refund_fee : 0n;
  if (net <= 0n) return null;
  return { gross, net };
}

export class RefundService {
  private readonly ledger: BookingLedger;

  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly audit: AuditWriter,
  ) {
    this.ledger = new BookingLedger(clock);
  }

  /** Khoá chống trùng chạy trước giao dịch: kiểm thân lệnh, phiên và phạm vi cơ sở sớm. */
  async authorizeFor(db: PrismaClient, actor: AuthorizedActor, bookingId: string): Promise<void> {
    await this.authorize(db, actor, bookingId);
  }

  authorizeRefundFor(db: PrismaClient, actor: AuthorizedActor, refundId: string): Promise<void> {
    return db.refund_requests
      .findUnique({ where: { id: refundId }, select: { booking_id: true } })
      .then(async (found) => {
        if (!found) throw refundError('missing');
        await this.authorize(db, actor, found.booking_id);
      });
  }

  /** Phiên còn hiệu lực và còn phạm vi cơ sở của booking (BR-RBAC-02, OWNER toàn chuỗi). */
  private async authorize(
    tx: Tx | PrismaClient,
    actor: AuthorizedActor,
    bookingId: string,
  ): Promise<{ role: string }> {
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
      throw refundError('forbidden', 'Phiên làm việc đã thay đổi.');
    const booking = await tx.bookings.findUnique({
      where: { id: bookingId },
      select: { property_id: true },
    });
    if (!booking) throw refundError('missing');
    const scoped =
      user.role === 'OWNER' ||
      user.user_property_scopes.some((scope) => scope.property_id === booking.property_id);
    if (!scoped) throw refundError('forbidden', 'Hồ sơ ngoài phạm vi cơ sở.');
    return { role: user.role };
  }

  /** Lập hồ sơ hoàn PENDING kèm giữ hạn mức NET qua `BookingLedger.reserve` (ADR-016). */
  async create(
    tx: Tx,
    actor: AuthorizedActor,
    input: RefundRequestCreateRequest,
    key: string,
  ): Promise<RefundRequest> {
    try {
      const { role } = await this.authorize(tx, actor, input.bookingId);
      this.checkForceMajeure(role, input.isForceMajeure, input.note);
      const projection = await this.ledger.read(tx, input.bookingId);
      // `paymentId` phải là chứng từ thu SUCCEEDED của booking — không nhận ID tuỳ ý (api.md §1).
      if (!projection.sources.some((row) => row.paymentId === input.paymentId))
        throw refundError('invalid', 'Nguồn thu không thuộc booking này.');
      const facts = await readFacts(tx, input.bookingId, true, projection.paidAmount);
      const state = engineStates.find((candidate) => candidate === facts.status) ?? null;
      if (state === null) throw refundError('notEligible');
      const decision = decide(
        facts,
        { state, forceMajeure: input.isForceMajeure, selected: activeRooms(facts) },
        this.clock.now().getTime(),
      );
      if (decision.net <= 0n)
        throw refundError('amountMismatch', 'Hoàn ròng sau phí phải lớn hơn 0.');
      const requestId = await insertRequest(
        tx,
        input.bookingId,
        eventKeyOf(input.paymentId, key),
        decision,
        {
          paymentId: input.paymentId,
          reason: input.reason,
          isForceMajeure: input.isForceMajeure,
          ...(input.evidenceRefs === undefined ? {} : { evidenceRefs: input.evidenceRefs }),
        },
        actor,
        this.clock.now(),
      );
      // Giữ hạn mức NET tại PENDING; thiếu quỹ thì LedgerError làm rollback cả hồ sơ lẫn hạn mức.
      await this.ledger.reserve(
        tx,
        input.bookingId,
        requestId,
        decision.legs.map((leg) => ({ paymentId: leg.paymentId, amount: leg.amount })),
        actor,
      );
      return await requestView(tx, await lockRefund(tx, requestId));
    } catch (error) {
      return refundFailure(error);
    }
  }

  /** Duyệt hồ sơ PENDING: một MANAGER/OWNER khác người lập, còn giữ quỹ, đòi `pinToken`. */
  async approve(
    tx: Tx,
    checker: AuthorizedActor,
    refundId: string,
    input: unknown,
  ): Promise<RefundDecision> {
    try {
      const decided = approveInput(input);
      const plan = await this.open(tx, checker, refundId);
      // So `created_by` với actor, không theo vai (BR-CANCEL-15): trùng người lập ⇒ chặn mọi mức.
      if (plan.row.requested_by !== null && plan.row.requested_by === checker.id)
        throw refundError('selfApproval');
      const legs = approvedLegs(plan.row, decided);
      if (legs === null)
        throw refundError(
          'amountMismatch',
          'Số duyệt phải dương, ≤ số yêu cầu, NET dương sau phí.',
        );
      const { gross, net } = legs;
      // Ngưỡng kiểm soát xét theo NET của toàn sự kiện (ADR-016) — không tách hồ sơ né ngưỡng.
      const eventNet = await settlementNet(tx, plan.row.booking_id),
        threshold = await thresholdAmount(tx);
      if (eventNet > threshold && !deciders.includes(plan.role))
        throw refundError('forbidden', 'Hồ sơ trên ngưỡng cần MANAGER trở lên duyệt.');
      // Tiêu thụ một lần cho thao tác tài chính, gắn đúng booking của hồ sơ (HB-015, BR-RBAC-05).
      await requirePinToken(tx, {
        userId: checker.id,
        token: decided.pinToken,
        purpose: PIN_PURPOSE_FINANCIAL,
        bookingId: plan.row.booking_id,
        now: this.clock.now(),
      });
      const now = this.clock.now(),
        reason = decisionNote(decided.note, 'Duyệt hoàn tiền');
      await reallocate(tx, plan.row.id, net, now);
      await recordDecision(
        tx,
        plan.row,
        { id: checker.id, role: plan.role },
        'APPROVED',
        gross,
        reason,
        now,
      );
      const action = 'REFUND_APPROVED';
      await this.audit.record(tx, {
        actor: checker,
        action,
        entityType: 'RefundRequest',
        entityId: plan.row.id,
        beforeJson: {
          status: plan.row.status,
          requestedAmount: plan.row.requested_amount.toString(),
        },
        afterJson: {
          bookingId: plan.row.booking_id,
          status: 'APPROVED',
          approvedAmount: gross.toString(),
          refundFee: plan.row.refund_fee.toString(),
          netRefund: net.toString(),
          eventNetRefund: eventNet.toString(),
          requiresThresholdControl: eventNet > threshold,
          note: decided.note ?? null,
        },
        reason,
      });
      return refundDecisionSchema.parse({
        id: plan.row.id,
        status: 'APPROVED',
        requestedAmount: vnd(plan.row.requested_amount),
        approvedAmount: vnd(gross),
        refundPercent: Math.round(Number(plan.row.refund_percent)),
        requestedBy: plan.row.requested_by ?? plan.row.requester_id,
        approvedBy: checker.id,
        decidedAt: now.toISOString(),
        auditLogId: await auditLogId(tx, plan.row.id, action),
        payoutDeadline: payoutDeadline(now),
      });
    } catch (error) {
      return refundFailure(error);
    }
  }

  /** Từ chối hồ sơ PENDING: bản ghi REJECTED độc lập và trả hạn mức cùng transaction (BR-CANCEL-17). */
  async reject(
    tx: Tx,
    checker: AuthorizedActor,
    refundId: string,
    input: unknown,
  ): Promise<RefundRequest> {
    try {
      const decided = rejectInput(input);
      const plan = await this.open(tx, checker, refundId);
      // Bảng `refund_approvals` cũng đòi approver khác người lập nên kiểm ở đây, không để DB nổ.
      if (plan.row.requested_by !== null && plan.row.requested_by === checker.id)
        throw refundError('selfApproval');
      const now = this.clock.now(),
        reason = decisionNote(decided.note, 'Từ chối hoàn tiền');
      await requirePinToken(tx, {
        userId: checker.id,
        token: decided.pinToken,
        purpose: PIN_PURPOSE_FINANCIAL,
        bookingId: plan.row.booking_id,
        now,
      });
      await recordDecision(
        tx,
        plan.row,
        { id: checker.id, role: plan.role },
        'REJECTED',
        0n,
        reason,
        now,
      );
      await this.audit.record(tx, {
        actor: checker,
        action: 'REFUND_REJECTED',
        entityType: 'RefundRequest',
        entityId: plan.row.id,
        beforeJson: { status: plan.row.status },
        afterJson: {
          bookingId: plan.row.booking_id,
          status: 'REJECTED',
          requestedAmount: plan.row.requested_amount.toString(),
        },
        reason,
      });
      return requestView(tx, await lockRefund(tx, plan.row.id));
    } catch (error) {
      return refundFailure(error);
    }
  }

  /** Rút hồ sơ PENDING: người tạo, hoặc MANAGER/OWNER đúng phạm vi — không khôi phục booking. */
  async cancel(
    tx: Tx,
    actor: AuthorizedActor,
    refundId: string,
    input: unknown,
  ): Promise<RefundRequest> {
    try {
      const decided = cancelInput(input);
      const plan = await this.open(tx, actor, refundId);
      const own = plan.row.requested_by !== null && plan.row.requested_by === actor.id;
      if (!own && !deciders.includes(plan.role))
        throw refundError('forbidden', 'Chỉ người tạo hoặc MANAGER/OWNER được rút hồ sơ.');
      const now = this.clock.now(),
        reason = decisionNote(decided.reason, 'Rút hồ sơ hoàn tiền');
      await withdraw(tx, plan.row, now);
      await this.audit.record(tx, {
        actor,
        action: 'REFUND_CANCELLED',
        entityType: 'RefundRequest',
        entityId: plan.row.id,
        beforeJson: { status: plan.row.status },
        afterJson: {
          bookingId: plan.row.booking_id,
          status: 'CANCELLED',
          requestedAmount: plan.row.requested_amount.toString(),
        },
        reason,
      });
      return requestView(tx, await lockRefund(tx, plan.row.id));
    } catch (error) {
      return refundFailure(error);
    }
  }

  /** Tải/khoá hồ sơ và sổ tiền (booking, payment, refund cùng booking) trước mọi quyết định. */
  private async open(
    tx: Tx,
    actor: AuthorizedActor,
    refundId: string,
  ): Promise<{ row: RefundRow; role: string }> {
    const found = await tx.refund_requests.findUnique({
      where: { id: refundId },
      select: { booking_id: true },
    });
    if (!found) throw refundError('missing');
    const [{ role }] = await Promise.all([
      this.authorize(tx, actor, found.booking_id),
      this.ledger.read(tx, found.booking_id),
    ]);
    const row = await lockRefund(tx, refundId);
    if (row.status !== 'PENDING') throw refundError('notPending');
    return { row, role };
  }

  /** BR-CANCEL-13: bất khả kháng chỉ MANAGER+ và `note` ≥ 20 ký tự — kiểm ở lệnh lập hồ sơ. */
  private checkForceMajeure(role: string, isForceMajeure: boolean, note?: string): void {
    if (!isForceMajeure) return;
    if (!deciders.includes(role)) throw refundError('forceMajeure');
    if ((note ?? '').trim().length < forceMajeureNote) throw refundError('reasonTooShort');
  }
}
