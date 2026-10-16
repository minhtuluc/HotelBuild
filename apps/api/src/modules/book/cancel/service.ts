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
import { previewFingerprint, previewTag } from './anchor.js';
import type { PreviewBreakdown } from './anchor.js';
import { readFacts } from './context.js';
import type { CancelDecision, CancelFacts, DecisionInput } from './context.js';
import { decide } from './engine.js';
import { forceMajeureForbidden, missing, notAllowed, previewAnchor, stale } from './validation.js';
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
/** BR-CHAN-04: chỉ ba kênh OTA đã đăng ký mới huỷ theo chính sách kênh. */
const otaChannels = ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'] as const;
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

  /**
   * AC1: xem trước thuần đọc. `rooms` là tập phòng cùng kênh dữ liệu với lệnh huỷ (bỏ trống ⇒ mọi phòng
   * đang hoạt động). Cảnh báo bất khả kháng trả trong `warnings` để lệnh xem trước **không** bị chặn.
   */
  async preview(
    actor: AuthorizedActor,
    bookingId: string,
    input: { reason: string; isForceMajeure: boolean },
    rooms: readonly string[] | null,
  ): Promise<{ body: CancelPreview; tag: string }> {
    try {
      return await this.db.$transaction(
        async (tx) => {
          await this.authorize(tx, actor, bookingId);
          const projection = await this.ledger.read(tx, bookingId);
          const facts = await readFacts(tx, bookingId, false, projection.paidAmount);
          const selected = this.effectiveSelection(facts, rooms);
          const decision = decide(
            facts,
            {
              state: cancellableState(facts.status) ?? this.rejectState(),
              forceMajeure: input.isForceMajeure,
              selected,
            },
            this.clock.now().getTime(),
          );
          const breakdown = this.breakdown(facts, decision);
          return {
            body: cancelPreviewSchema.parse({
              bookingId: facts.id,
              currency: 'VND',
              cancellation: breakdown,
              warnings: this.previewWarnings(actor, facts, input),
            }),
            tag: previewTag(facts.version, breakdown, selected, input.isForceMajeure),
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
    tag: unknown,
  ): Promise<CancelResponse> {
    try {
      const plan = await this.plan(tx, actor, bookingId, input, tag);
      return await this.apply(tx, actor, plan, input, this.clock.now());
    } catch (error) {
      safeError(error);
    }
  }

  /**
   * Kiểm lại toàn bộ điều kiện của lần huỷ **trong transaction** trước khi ghi: phạm vi, trạng thái,
   * điều kiện bất khả kháng, mốc phiên bản và vân tay của cả kết quả xem trước (AC1, BR-CANCEL-13).
   * Thứ tự: phạm vi/trạng thái trước, rồi neo xem trước — lỗi `404`/`403`/`409` không bị neo cũ che mất.
   */
  private async plan(
    tx: Tx,
    actor: AuthorizedActor,
    bookingId: string,
    input: CancelRequest,
    tag: unknown,
  ): Promise<Plan> {
    await this.authorize(tx, actor, bookingId);
    const projection = await this.ledger.read(tx, bookingId);
    const facts = await readFacts(tx, bookingId, true, projection.paidAmount);
    if (!cancellableState(facts.status)) throw notAllowed('Booking không ở trạng thái có thể huỷ.');
    this.checkForceMajeure(actor, input);
    const anchor = previewAnchor(tag);
    if (anchor.version !== facts.version) throw stale();
    const selected = this.selection(facts, input);
    const decision = decide(
      facts,
      {
        state: cancellableState(facts.status) ?? this.rejectState(),
        forceMajeure: input.isForceMajeure,
        selected,
      },
      this.clock.now().getTime(),
    );
    const breakdown = this.breakdown(facts, decision);
    if (anchor.fingerprint !== previewFingerprint(breakdown, selected, input.isForceMajeure))
      throw stale();
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
    // BR-CHAN-04: chỉ booking **đến từ kênh OTA đã xác minh** mới bỏ xử lý hoàn nội bộ.
    const channelManaged = this.channelManaged(facts, input);
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
        channelManaged,
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

  /** Phiên còn hiệu lực và còn phạm vi cơ sở của booking (BR-RBAC-02, OWNER toàn chuỗi). */
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
    // `canActOn` (common/rbac/scope.ts): OWNER có phạm vi toàn chuỗi, không cần hàng `user_property_scopes`.
    const scoped =
      user.role === 'OWNER' ||
      user.user_property_scopes.some((scope) => scope.property_id === booking.property_id);
    if (!scoped) throw new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Booking ngoài phạm vi cơ sở.');
  }

  /** BR-CANCEL-13: chỉ MANAGER/OWNER được tạo, `note` ≥ 20 ký tự — kiểm ở **lệnh huỷ**, không ở xem trước. */
  private checkForceMajeure(
    actor: AuthorizedActor,
    input: { isForceMajeure: boolean; note?: string | undefined },
  ): void {
    if (!input.isForceMajeure) return;
    if (!forceMajeureRoles.includes(actor.role)) throw forceMajeureForbidden();
    if ((input.note ?? '').trim().length < forceMajeureNote)
      throw new AppError(400, 'E_PAY_REASON_TOO_SHORT', 'Lý do bất khả kháng cần ≥ 20 ký tự.');
  }

  /** Cảnh báo để lệnh xem trước vẫn chạy cho mọi vai trò có quyền đọc; lệnh huỷ mới là nơi chặn. */
  private previewWarnings(
    actor: AuthorizedActor,
    facts: CancelFacts,
    input: { reason: string; isForceMajeure: boolean },
  ): string[] {
    const warnings: string[] = [];
    if (input.isForceMajeure && !forceMajeureRoles.includes(actor.role))
      warnings.push('FORCE_MAJEURE_REQUIRES_MANAGER');
    if (input.reason === 'OTA_CANCELLATION' && !this.verifiedOta(facts))
      warnings.push('OTA_REASON_REQUIRES_OTA_CHANNEL');
    return warnings;
  }

  /** BR-CHAN-04: kênh OTA đã đăng ký **và** booking có mã chính sách kênh ⇒ OTA hoàn theo hợp đồng kênh. */
  private verifiedOta(facts: CancelFacts): boolean {
    return (
      otaChannels.some((code) => code === facts.channelCode) &&
      (facts.channelPolicyCode ?? '').length > 0
    );
  }

  private channelManaged(facts: CancelFacts, input: CancelRequest): boolean {
    if (input.reason !== 'OTA_CANCELLATION') return false;
    if (!this.verifiedOta(facts))
      throw notAllowed('Lý do OTA chỉ áp cho booking đến từ kênh OTA đã xác minh (BR-CHAN-04).');
    return true;
  }

  /** Bỏ trống tập phòng ⇒ toàn bộ phòng đang hoạt động (như lệnh huỷ không truyền `bookingRoomIds`). */
  private effectiveSelection(facts: CancelFacts, rooms: readonly string[] | null): string[] {
    const selected = rooms ?? facts.rooms.filter((room) => room.active).map((room) => room.roomId);
    if (!selected.length) throw notAllowed('Booking không còn phòng hoạt động để huỷ.');
    return [...new Set(selected)].sort();
  }

  /** Chỉ chọn BookingRoom ACTIVE; danh sách phòng chỉ dùng khi booking nhiều phòng (api.md §3.3). */
  private selection(facts: CancelFacts, input: CancelRequest): string[] {
    const active = facts.rooms.filter((room) => room.active).map((room) => room.roomId);
    const chosen = input.bookingRoomIds ?? [];
    if (!chosen.length) {
      if (!active.length) throw notAllowed('Booking không còn phòng hoạt động để huỷ.');
      return active.sort();
    }
    if (facts.rooms.length < 2)
      throw notAllowed('Booking một phòng huỷ toàn phần, không nhận bookingRoomIds.');
    const selected = [...new Set(chosen)].sort();
    if (selected.length >= facts.rooms.length)
      throw notAllowed('Huỷ hết phòng là huỷ toàn phần, không nhận bookingRoomIds.');
    return selected;
  }

  private rejectState(): never {
    throw notAllowed('Booking không ở trạng thái có thể huỷ.');
  }

  /** Mốc giờ trả ở 2 chữ số thập phân (khớp cột `hours_before_check_in`) để hai lần đọc so sánh được. */
  private breakdown(facts: CancelFacts, decision: CancelDecision): PreviewBreakdown {
    return {
      policyId: decision.policyId,
      appliedTierId: decision.tierId ?? decision.token,
      hoursBeforeCheckIn: Math.round(decision.hours * 100) / 100,
      refundPercent: decision.refundPercent,
      paidAmount: safeAmount(facts.paidAmount),
      requestedAmount: safeAmount(decision.requested),
      penaltyAmount: safeAmount(decision.penalty),
      refundFee: safeAmount(decision.fee),
    };
  }
}
