import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import {
  cancelPreviewSchema,
  cancelResponseSchema,
  type CancelPreview,
  type CancelRequest,
  type CancelResponse,
} from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { BookingLedger } from '../../pay/ledger/service.js';
import { readFacts } from './context.js';
import { decide } from './engine.js';
import type { CancelDecision, CancelFacts, DecisionInput } from './context.js';
import { forceMajeureForbidden, missing, notAllowed, stale } from './validation.js';
import type { PreviewAnchor } from './validation.js';
import {
  closeBooking,
  partialSnapshot,
  recordPenalty,
  recordRefund,
  releaseAssignments,
  safeAmount,
  safeError,
  voidRoomCharges,
  type Tx,
} from './writes.js';

const cancellableStates = ['HELD', 'PENDING_PAYMENT', 'CONFIRMED'] as const;
const forceMajeureRoles = ['MANAGER', 'OWNER'];
/** BR-CANCEL-13: bất khả kháng cần lý do trong `note` ≥ 20 ký tự. */
const forceMajeureNote = 20;

function cancellableState(value: string): DecisionInput['state'] | null {
  return cancellableStates.find((state) => state === value) ?? null;
}

interface Plan {
  readonly facts: CancelFacts;
  readonly selected: readonly string[];
  readonly decision: CancelDecision;
  readonly paidAmount: bigint;
}

export class CancelService {
  private readonly ledger: BookingLedger;

  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly audit: AuditWriter,
  ) {
    this.ledger = new BookingLedger(clock);
  }

  /** Neo cho khoá chống trùng: kiểm phiên, phạm vi cơ sở và tình trạng booking trước khi ghi. */
  async authorizeFor(db: PrismaClient, actor: AuthorizedActor, bookingId: string): Promise<void> {
    await this.authorize(db, actor, bookingId);
  }

  /** AC1: xem trước thuần đọc — không ghi hàng nào, không đổi trạng thái booking. */
  async preview(
    actor: AuthorizedActor,
    bookingId: string,
    input: { reason: string; isForceMajeure: boolean },
  ): Promise<{ body: CancelPreview; tag: string }> {
    try {
      return await this.db.$transaction(
        async (tx) => {
          await this.authorize(tx, actor, bookingId);
          const projection = await this.ledger.read(tx, bookingId);
          const facts = await readFacts(tx, bookingId, false, projection.paidAmount);
          const decision = this.decide(facts, actor, input, null);
          return {
            body: cancelPreviewSchema.parse({
              bookingId: facts.id,
              currency: 'VND',
              cancellation: this.breakdown(facts, decision),
              warnings: [],
            }),
            // Neo xem trước: mốc phiên bản + bậc đã xem — `cancel` kiểm lại cả hai (AC1).
            tag: `"${facts.version}.${decision.token}"`,
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    } catch (error) {
      safeError(error);
    }
  }

  async cancel(
    tx: Tx,
    actor: AuthorizedActor,
    bookingId: string,
    input: CancelRequest,
    anchor: PreviewAnchor | null,
  ): Promise<CancelResponse> {
    try {
      const plan = await this.plan(tx, actor, bookingId, input, anchor);
      return await this.apply(tx, actor, plan, input, this.clock.now());
    } catch (error) {
      safeError(error);
    }
  }

  /** Kiểm lại toàn bộ điều kiện của lần huỷ **trong transaction** trước khi ghi (AC1). */
  private async plan(
    tx: Tx,
    actor: AuthorizedActor,
    bookingId: string,
    input: CancelRequest,
    anchor: PreviewAnchor | null,
  ): Promise<Plan> {
    await this.authorize(tx, actor, bookingId);
    const projection = await this.ledger.read(tx, bookingId);
    const facts = await readFacts(tx, bookingId, true, projection.paidAmount);
    if (!cancellableState(facts.status)) throw notAllowed('Booking không ở trạng thái có thể huỷ.');
    if (anchor && anchor.version !== facts.version) throw stale();
    const selected = this.selection(facts, input);
    const decision = this.decide(facts, actor, input, selected);
    // Mốc giờ/version lệch kể từ lần xem trước ⇒ buộc xem trước lại trước khi ghi.
    if (anchor?.decision && anchor.decision !== decision.token) throw stale();
    return { facts, selected, decision, paidAmount: projection.paidAmount };
  }

  private async apply(
    tx: Tx,
    actor: AuthorizedActor,
    plan: Plan,
    input: CancelRequest,
    now: Date,
  ): Promise<CancelResponse> {
    const { facts, selected, decision } = plan;
    // BR-CHAN-04: huỷ theo chính sách OTA không tạo RefundRequest/phụ thu trong hệ thống.
    const channelManaged = input.reason === 'OTA_CANCELLATION';
    const released = await releaseAssignments(tx, selected, input.reason, now);
    await voidRoomCharges(tx, facts.id, selected, input.reason, now);
    await tx.booking_rooms.updateMany({
      where: { id: { in: [...selected] } },
      data: { status: 'CANCELLED', cancelled_at: now, updated_at: now },
    });
    // Huỷ hết phòng **đang hoạt động** mới là huỷ toàn phần (BR-CANCEL-19).
    const leaving = facts.rooms.filter((room) => room.active && !selected.includes(room.roomId));
    const total = await closeBooking(tx, facts, leaving.length === 0, input, now);
    const penaltyId =
      !channelManaged && decision.penalty > 0n
        ? await recordPenalty(tx, facts, decision, selected, actor.id, now)
        : null;
    const refund = await recordRefund(
      tx,
      this.ledger,
      actor,
      facts,
      decision,
      input,
      selected,
      channelManaged,
      now,
    );
    if (leaving.length) await partialSnapshot(tx, facts, leaving, total, now);
    await this.audit.record(tx, {
      actor,
      action: 'BOOKING_CANCELLED',
      entityType: 'Booking',
      entityId: facts.id,
      beforeJson: {
        propertyId: facts.propertyId,
        status: facts.status,
        version: safeAmount(facts.version),
        paidAmount: safeAmount(plan.paidAmount),
      },
      afterJson: {
        propertyId: facts.propertyId,
        status: leaving.length ? facts.status : 'CANCELLED',
        cancelReason: input.reason,
        cancelledRoomIds: [...selected],
        releasedAssignmentCount: released,
        remainingTotalAmount: safeAmount(total),
        requestedAmount: safeAmount(decision.requested),
        penaltyAmount: safeAmount(decision.penalty),
        refundFee: safeAmount(decision.fee),
        refundRequestId: refund?.id ?? null,
        penaltyChargeId: penaltyId,
      },
      reason: input.note ?? input.reason,
    });
    const after = await tx.bookings.findUniqueOrThrow({
      where: { id: facts.id },
      select: { status: true, cancelled_at: true },
    });
    return cancelResponseSchema.parse({
      bookingId: facts.id,
      status: after.status,
      cancelledAt: (after.cancelled_at ?? now).toISOString(),
      cancelReason: input.reason,
      releasedAssignmentCount: released,
      cancellation: this.breakdown(facts, decision),
      refundRequest: refund,
    });
  }

  /** Phiên còn hiệu lực và còn phạm vi cơ sở của booking (BR-RBAC-02). */
  private async authorize(tx: Tx, actor: AuthorizedActor, bookingId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.id}::uuid FOR SHARE`;
    const user = await tx.users.findUnique({
      where: { id: actor.id },
      select: {
        role: true,
        is_active: true,
        user_property_scopes: { select: { property_id: true } },
      },
    });
    if (!user?.is_active || user.role !== actor.role)
      throw new AppError(403, 'E_RBAC_FORBIDDEN', 'Phiên làm việc đã thay đổi.');
    const booking = await tx.bookings.findUnique({
      where: { id: bookingId },
      select: { property_id: true },
    });
    if (!booking) throw missing();
    if (!user.user_property_scopes.some((scope) => scope.property_id === booking.property_id))
      throw new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Booking ngoài phạm vi cơ sở.');
  }

  private decide(
    facts: CancelFacts,
    actor: AuthorizedActor,
    input: { isForceMajeure: boolean; note?: string | undefined },
    selected: readonly string[] | null,
  ): CancelDecision {
    const state = cancellableState(facts.status);
    if (!state) throw notAllowed('Booking không ở trạng thái có thể huỷ.');
    if (input.isForceMajeure && !forceMajeureRoles.includes(actor.role))
      throw forceMajeureForbidden();
    if (input.isForceMajeure && (input.note ?? '').trim().length < forceMajeureNote)
      throw new AppError(400, 'E_PAY_REASON_TOO_SHORT', 'Lý do bất khả kháng cần ≥ 20 ký tự.');
    const rooms = selected ?? facts.rooms.filter((room) => room.active).map((room) => room.roomId);
    return decide(
      facts,
      { state, forceMajeure: input.isForceMajeure, selected: rooms },
      this.clock.now().getTime(),
    );
  }

  /** Chỉ chọn BookingRoom ACTIVE; danh sách phòng chỉ dùng khi booking nhiều phòng (api.md §3.3). */
  private selection(facts: CancelFacts, input: CancelRequest): string[] {
    const active = facts.rooms.filter((room) => room.active).map((room) => room.roomId);
    const chosen = input.bookingRoomIds ?? [];
    if (!chosen.length) {
      if (!active.length) throw notAllowed('Booking không còn phòng hoạt động để huỷ.');
      return active;
    }
    if (facts.rooms.length < 2)
      throw notAllowed('Booking một phòng huỷ toàn phần, không nhận bookingRoomIds.');
    const selected = [...new Set(chosen)];
    if (selected.length >= facts.rooms.length)
      throw notAllowed('Huỷ hết phòng là huỷ toàn phần, không nhận bookingRoomIds.');
    return selected;
  }

  private breakdown(facts: CancelFacts, decision: CancelDecision) {
    return {
      policyId: decision.policyId,
      appliedTierId: decision.tierId ?? decision.token,
      hoursBeforeCheckIn: decision.hours,
      refundPercent: decision.refundPercent,
      paidAmount: safeAmount(facts.paidAmount),
      requestedAmount: safeAmount(decision.requested),
      penaltyAmount: safeAmount(decision.penalty),
      refundFee: safeAmount(decision.fee),
    };
  }
}
