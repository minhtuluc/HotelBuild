/**
 * Lệnh trả phòng (`POST /front-office/check-out`, UC-FO-02; BR-FO-03/05/06, BR-CANCEL-09).
 *
 * Một transaction nghiệp vụ duy nhất, khoá theo ADR-014 (`bookings → properties → room_types`,
 * rồi sổ tiền `payments → refund_requests`):
 *
 * 1. `lockBooking` rồi mới kiểm trạng thái/phạm vi; PIN một lần gắn booking được **tiêu thụ trong
 *    chính transaction này** (HB-015) — thiếu/sai/đã dùng ⇒ `401 E_AUTH_PIN_REQUIRED`, rollback sạch.
 * 2. Phụ thu muộn do engine HB-142 (`checkOutFee`) quyết theo giờ nghiệp vụ VN; phát sinh là nghĩa vụ
 *    thật `booking_charges` + `BookingLedger.sync` (BR-FO-05). Trả sớm chỉ lấy dữ kiện từ engine.
 * 3. `balanceDue > 0` (nợ cũ **hoặc** phụ thu vừa ghi) ⇒ ghi nghĩa vụ rồi từ chối `422`, **không**
 *    giải phóng phòng, **không** sinh việc dọn, **không** ghi lịch sử/audit `CHECKED_OUT`.
 *    Vì vậy transaction nghiệp vụ tự mở (không dùng transaction idempotency của HB-029): phản hồi lỗi
 *    của interceptor luôn rollback, còn nghĩa vụ phải sống sót để thu rồi thử lại.
 * 4. Thu đủ ⇒ `CHECKED_OUT` + giải phóng assignment + một `HousekeepingTask` PENDING/ngày trả phòng
 *    + lịch sử + audit + outbox trong cùng transaction (BR-FO-06, BR-CHAN-06).
 * 5. Trả sớm: dùng engine huỷ HB-053 với `cancelReason = EARLY_CHECKOUT` qua đúng đường ghi
 *    `recordRefund` của F5 (không chép công thức chính sách); booking kết thúc `CHECKED_OUT`,
 *    không `CANCELLED`.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { checkOutFee } from '@pinehill/domain/front-office';
import type { CheckOutFeeDecision } from '@pinehill/domain/front-office';
import {
  checkOutPreviewSchema,
  checkOutResponseSchema,
  type CancelRequest,
  type CheckOutPreview,
  type CheckOutPreviewRequest,
  type CheckOutRequest,
  type CheckOutResponse,
} from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { ApiConfig } from '../../../config/env.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { lockBooking } from '../../book/bookings/lock.js';
import type { LockedBooking } from '../../book/bookings/lock.js';
import { PIN_PURPOSE_FINANCIAL, requirePinToken } from '../../auth/pin/consume.js';
import { readFacts } from '../../book/cancel/context.js';
import type { CancelDecision } from '../../book/cancel/context.js';
import { recordRefund, releaseAssignments } from '../../book/cancel/writes.js';
import { BookingLedger } from '../../pay/ledger/service.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { planEarlyRefund, voidUnusedNights } from './early.js';
import type { Voids } from './early.js';
import { replayCheckOut } from './replay.js';
import { ensureHousekeepingTasks } from './tasks.js';
import {
  FEE_SOURCE_KEY,
  bookedFee,
  dateOnly,
  extraLines,
  localDate,
  lastNightAmount,
  localNow,
  recordObligations,
  safeError,
} from './support.js';
import type { LedgerProjection } from '../../pay/ledger/types.js';
import {
  balanceUnsettled,
  earlyMismatch,
  forbidden,
  internal,
  invalidState,
  missing,
  outOfScope,
} from './validation.js';

type Tx = Prisma.TransactionClient;

const CHECKED_IN = 'CHECKED_IN';
const CHECKED_OUT = 'CHECKED_OUT';

/** Kết quả nghiệp vụ: từ chối vì số dư (đã ghi nghĩa vụ) hoặc hoàn tất trả phòng. */
type Outcome =
  | { readonly kind: 'refused'; readonly balanceDue: bigint }
  | { readonly kind: 'done'; readonly response: CheckOutResponse };

/** Dữ kiện đã khoá/đã quyết của một lần trả phòng thành công. */
interface Completion {
  readonly booking: LockedBooking;
  readonly businessNow: Date;
  readonly now: Date;
  readonly rooms: readonly string[];
  readonly decision: CheckOutFeeDecision;
  readonly extrasAmount: number;
  readonly input: CheckOutRequest;
  readonly paidAmount: bigint;
  /** Nghĩa vụ đêm chưa ở đã void + tiền thực nhả (rỗng khi không trả sớm). */
  readonly voids: Voids;
  /** Phụ thu **đã ghi sổ** (đọc lại từ `booking_charges`), không phải con số engine vừa tính. */
  readonly feeAmount: number;
}

/** Kết quả ghi nghĩa vụ + chiếu sổ cái của một lần trả phòng (dùng chung lệnh ghi và xem trước). */
interface Settlement {
  readonly rooms: readonly string[];
  readonly decision: CheckOutFeeDecision;
  readonly now: Date;
  readonly extrasAmount: number;
  readonly voids: Voids;
  readonly feeAmount: number;
  readonly projection: LedgerProjection;
}

/** Mang kết quả xem trước ra khỏi transaction bị rollback có chủ đích (không có ghi nào được commit). */
class PreviewRollback {
  constructor(readonly value: CheckOutPreview) {}
}

export class CheckOutService {
  private readonly ledger: BookingLedger;

  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly config: ApiConfig,
    readonly audit: AuditWriter,
  ) {
    this.ledger = new BookingLedger(clock);
  }

  /** Neo kiểm phiên/phạm vi trước khi khoá chống trùng (như `CancelAccess` của HB-097). */
  async authorizeFor(db: PrismaClient, actor: AuthorizedActor, bookingId: string): Promise<void> {
    await db.$queryRaw`SELECT id FROM users WHERE id=${actor.id}::uuid FOR SHARE`;
    const user = await db.users.findUnique({
      where: { id: actor.id },
      select: {
        role: true,
        is_active: true,
        user_property_scopes: { select: { property_id: true } },
      },
    });
    if (!user?.is_active || user.role !== actor.role) throw forbidden();
    const booking = await db.bookings.findUnique({
      where: { id: bookingId },
      select: { property_id: true },
    });
    if (!booking) throw missing();
    const scoped =
      user.role === 'OWNER' ||
      user.user_property_scopes.some((scope) => scope.property_id === booking.property_id);
    if (!scoped) throw outOfScope();
  }

  /**
   * Trả phòng chạy trong transaction nghiệp vụ tự mở. Khi từ chối vì số dư, transaction đã commit
   * nghĩa vụ phụ thu/phát sinh rồi mới ném lỗi `422` ra ngoài (BR-FO-05).
   */
  async checkOut(actor: AuthorizedActor, input: CheckOutRequest): Promise<CheckOutResponse> {
    try {
      const outcome = await this.db.$transaction((tx) => this.execute(tx, actor, input), {
        isolationLevel: 'ReadCommitted',
      });
      if (outcome.kind === 'refused') throw balanceUnsettled();
      return outcome.response;
    } catch (error) {
      safeError(error);
    }
  }

  private async execute(tx: Tx, actor: AuthorizedActor, input: CheckOutRequest): Promise<Outcome> {
    const booking = await this.lockAndAuthorize(tx, actor, input.bookingId);
    // Response đã mất sau khi transaction nghiệp vụ commit ⇒ dựng lại từ sổ, không trả 409.
    if (booking.status === CHECKED_OUT)
      return {
        kind: 'done',
        response: await replayCheckOut(
          tx,
          booking.id,
          await this.activeRooms(tx, booking.id),
          input,
        ),
      };
    if (booking.status !== CHECKED_IN) throw invalidState();
    const businessNow = this.clock.now();
    await requirePinToken(tx, {
      userId: actor.id,
      token: input.pinToken,
      purpose: PIN_PURPOSE_FINANCIAL,
      bookingId: booking.id,
      now: businessNow,
    });

    const { rooms, decision, now, extrasAmount, voids, feeAmount, projection } = await this.settle(
      tx,
      actor,
      booking,
      input,
      businessNow,
    );
    if (projection.balanceDue > 0n) return { kind: 'refused', balanceDue: projection.balanceDue };

    return {
      kind: 'done',
      response: await this.complete(tx, actor, {
        booking,
        businessNow,
        now,
        rooms,
        decision,
        extrasAmount,
        input,
        paidAmount: projection.paidAmount,
        voids,
        feeAmount,
      }),
    };
  }

  /**
   * Từ "còn phòng ACTIVE" tới "chiếu lại sổ cái": quyết định phụ thu bằng engine HB-142, ghi nghĩa vụ
   * phụ thu/phát sinh, void đêm chưa ở khi trả sớm rồi `ledger.sync`. **Một** đường duy nhất cho lệnh
   * trả phòng và xem trước (HB-209) nên hai bên không thể lệch số.
   */
  private async settle(
    tx: Tx,
    actor: AuthorizedActor,
    booking: LockedBooking,
    input: Pick<CheckOutRequest, 'earlyCheckOut' | 'extras'>,
    businessNow: Date,
  ): Promise<Settlement> {
    const rooms = await this.activeRooms(tx, booking.id);
    if (!rooms.length) throw invalidState();
    const decision = await this.decideFee(tx, booking, rooms, input.earlyCheckOut, businessNow);
    const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
    const extras = extraLines(input.extras);
    const extrasAmount = extras.reduce((sum, line) => sum + line.amount, 0);
    await recordObligations(tx, booking.id, decision.lateCheckOutFee, extras, now);
    const voids =
      decision.earlyCheckout === null
        ? { value: 0n, released: new Map<string, bigint>() }
        : await voidUnusedNights(
            tx,
            booking.id,
            rooms,
            localDate(businessNow, this.config.BUSINESS_TIMEZONE),
            dateOnly(booking.checkOut),
            now,
          );
    const feeAmount = await bookedFee(tx, booking.id, FEE_SOURCE_KEY);
    const projection = await this.ledger.sync(tx, booking.id, actor);
    return { rooms, decision, now, extrasAmount, voids, feeAmount, projection };
  }

  /**
   * Xem trước trả phòng (HB-209, TD-28). Chạy **đúng** `settle` của lệnh ghi (cùng khoá, cùng engine,
   * cùng chiếu sổ cái) rồi **luôn rollback**: không PIN, không hoàn tất trả phòng và không có ghi nào
   * được commit — số trả về chính là số lệnh ghi sẽ để lại ngay sau đó với cùng dữ liệu và đồng hồ.
   * Booking đã `CHECKED_OUT` không có gì để xem trước nên cùng `409` với booking chưa nhận phòng.
   */
  async preview(actor: AuthorizedActor, input: CheckOutPreviewRequest): Promise<CheckOutPreview> {
    try {
      await this.authorizeFor(this.db, actor, input.bookingId);
      await this.db.$transaction(
        async (tx) => {
          const booking = await this.lockAndAuthorize(tx, actor, input.bookingId);
          if (booking.status !== CHECKED_IN) throw invalidState();
          const businessNow = this.clock.now();
          const settled = await this.settle(tx, actor, booking, input, businessNow);
          if (settled.projection.balanceDue > BigInt(Number.MAX_SAFE_INTEGER)) throw internal();
          throw new PreviewRollback(
            checkOutPreviewSchema.parse({
              bookingId: booking.id,
              feeAmount: settled.feeAmount,
              extrasAmount: settled.extrasAmount,
              balanceDue: Number(settled.projection.balanceDue),
              computedAt: businessNow.toISOString(),
            }),
          );
        },
        { isolationLevel: 'ReadCommitted' },
      );
    } catch (error) {
      if (error instanceof PreviewRollback) return error.value;
      safeError(error);
    }
    throw internal();
  }

  /** Khoá booking rồi mới kiểm phạm vi (HB-093). Trạng thái được xử lý ở `execute`. */
  private async lockAndAuthorize(tx: Tx, actor: AuthorizedActor, bookingId: string) {
    const booking = await lockBooking(tx, bookingId);
    if (!actor.canActOn(booking.propertyId)) throw forbidden();
    return booking;
  }

  /** Quyết định phụ thu do engine HB-142; cờ trả sớm phải khớp ngày trả phòng thực tế. */
  private async decideFee(
    tx: Tx,
    booking: LockedBooking,
    rooms: readonly string[],
    earlyCheckOut: boolean,
    businessNow: Date,
  ): Promise<CheckOutFeeDecision> {
    const decision = checkOutFee({
      checkOutDate: dateOnly(booking.checkOut),
      localNow: localNow(businessNow, this.config.BUSINESS_TIMEZONE),
      lastNightAmount: await lastNightAmount(tx, booking.id, rooms, booking.checkOut),
    });
    if (!decision.ok) throw internal();
    const early = decision.value.earlyCheckout !== null;
    if (earlyCheckOut !== early) throw earlyMismatch();
    return decision.value;
  }

  /** Thành công: giải phóng, việc dọn, hoàn trả sớm, lịch sử + audit + outbox cùng transaction. */
  private async complete(
    tx: Tx,
    actor: AuthorizedActor,
    done: Completion,
  ): Promise<CheckOutResponse> {
    const { booking, now } = done;
    const assignments = await tx.room_assignments.findMany({
      where: { booking_room_id: { in: [...done.rooms] }, released_at: null },
      select: { room_id: true },
    });
    const released = await releaseAssignments(tx, done.rooms, 'CHECK_OUT', now);
    const roomIds = [...new Set(assignments.map((row) => row.room_id))].sort();
    const businessDate = new Date(
      `${localDate(done.businessNow, this.config.BUSINESS_TIMEZONE)}T00:00:00Z`,
    );
    const housekeepingTaskIds = await ensureHousekeepingTasks(tx, roomIds, businessDate, now);
    let refundRequestId: string | null = null;
    if (done.decision.earlyCheckout !== null) {
      const refund = await this.recordEarlyRefund(
        tx,
        actor,
        booking.id,
        done.voids,
        done.paidAmount,
        done.businessNow,
        now,
        done.input.note,
      );
      refundRequestId = refund?.id ?? null;
    }
    const reason =
      done.input.note === undefined ? 'Check-out' : maskOperationalText(done.input.note);

    await tx.bookings.update({
      where: { id: booking.id },
      data: { status: CHECKED_OUT, updated_at: now },
    });
    await tx.booking_status_history.create({
      data: {
        booking_id: booking.id,
        from_status: CHECKED_IN,
        to_status: CHECKED_OUT,
        reason,
        actor_id: actor.id,
        at: now,
        created_at: now,
        updated_at: now,
      },
    });
    await tx.outbox_events.create({
      data: {
        event_type: 'InventoryChanged',
        aggregate_type: 'Booking',
        aggregate_id: booking.id,
        payload_json: {
          propertyId: booking.propertyId,
          roomTypeId: booking.roomTypeId,
          startDate: businessDate.toISOString().slice(0, 10),
          endDate: dateOnly(booking.checkOut),
          roomIds,
          operation: 'BOOKING_CHECKED_OUT',
        },
        created_at: now,
        updated_at: now,
      },
    });
    await this.audit.record(tx, {
      actor,
      action: 'BOOKING_CHECKED_OUT',
      entityType: 'Booking',
      entityId: booking.id,
      beforeJson: {
        propertyId: booking.propertyId,
        status: CHECKED_IN,
        balanceDue: '0',
      },
      afterJson: {
        propertyId: booking.propertyId,
        status: CHECKED_OUT,
        checkedOutAt: now.toISOString(),
        feeAmount: done.feeAmount,
        extrasAmount: done.extrasAmount,
        releasedAssignmentCount: released,
        housekeepingTaskIds,
        refundRequestId,
      },
      reason: done.input.note === undefined ? null : reason,
    });

    return checkOutResponseSchema.parse({
      bookingId: booking.id,
      status: CHECKED_OUT,
      checkedOutAt: now.toISOString(),
      extrasAmount: done.extrasAmount,
      feeAmount: done.feeAmount,
      balanceDue: 0,
      housekeepingTaskIds,
    });
  }

  /** BookingRoom còn ACTIVE của booking — đơn vị bán bị trả phòng. */
  private async activeRooms(tx: Tx, bookingId: string): Promise<string[]> {
    const rows = await tx.booking_rooms.findMany({
      where: { booking_id: bookingId, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * BR-CANCEL-09: hoàn trả sớm tính từ cấu hình trả phòng sớm **đã chốt trong snapshot**; tầng này
   * chỉ chuyển dữ kiện và ghi `RefundRequest` qua đúng đường `recordRefund` của F5. Booking vẫn
   * `CHECKED_OUT` — không gọi `closeBooking`/void nghĩa vụ phòng như huỷ booking.
   */
  private async recordEarlyRefund(
    tx: Tx,
    actor: AuthorizedActor,
    bookingId: string,
    voids: Voids,
    paidAmount: bigint,
    businessNow: Date,
    now: Date,
    note: string | undefined,
  ) {
    const facts = await readFacts(tx, bookingId, true, paidAmount);
    const selected = facts.rooms
      .filter((room) => room.active)
      .map((room) => room.roomId)
      .sort();
    if (!selected.length) throw invalidState();
    const plan = planEarlyRefund(facts, voids, businessNow.getTime());
    if (plan.amount <= 0n) return null;
    const decision: CancelDecision = {
      hours: plan.noticeHours,
      tierId: null,
      token: 'EARLY_CHECKOUT',
      policyId: facts.policy.id,
      refundPercent: plan.refundPercent,
      base: plan.base,
      requested: plan.amount,
      penalty: 0n,
      fee: 0n,
      net: plan.amount,
      legs: plan.legs,
    };
    const request: CancelRequest = {
      reason: 'EARLY_CHECKOUT',
      isForceMajeure: false,
      bookingRoomIds: selected,
      ...(note === undefined ? {} : { note: maskOperationalText(note) }),
    };
    return recordRefund(tx, this.ledger, actor, facts, decision, request, selected, false, now);
  }
}
