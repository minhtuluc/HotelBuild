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
  checkOutResponseSchema,
  type CancelRequest,
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
import { decide } from '../../book/cancel/engine.js';
import { recordRefund, releaseAssignments } from '../../book/cancel/writes.js';
import { BookingLedger } from '../../pay/ledger/service.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { capReceipts, voidUnusedNights } from './early.js';
import { dateOnly, extraLines, localDate, localNow, safeError } from './support.js';
import type { ExtraLine } from './support.js';
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
const DAY = 86_400_000;
const FEE_SOURCE_KEY = 'checkout-late-fee';

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
  /** Giá trị nghĩa vụ ROOM của các đêm chưa ở đã void (0 khi không trả sớm). */
  readonly unusedValue: bigint;
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
    const businessNow = this.clock.now();
    await requirePinToken(tx, {
      userId: actor.id,
      token: input.pinToken,
      purpose: PIN_PURPOSE_FINANCIAL,
      bookingId: booking.id,
      now: businessNow,
    });

    const rooms = await this.activeRooms(tx, booking.id);
    if (!rooms.length) throw invalidState();
    const decision = await this.decideFee(tx, booking, rooms, input.earlyCheckOut, businessNow);
    const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
    const extras = extraLines(input.extras);
    const extrasAmount = extras.reduce((sum, line) => sum + line.amount, 0);
    await this.recordObligations(tx, booking.id, decision.lateCheckOutFee, extras, now);
    const unusedValue =
      decision.earlyCheckout === null
        ? 0n
        : await voidUnusedNights(
            tx,
            booking.id,
            rooms,
            localDate(businessNow, this.config.BUSINESS_TIMEZONE),
            dateOnly(booking.checkOut),
            now,
          );
    const projection = await this.ledger.sync(tx, booking.id, actor);
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
        unusedValue,
      }),
    };
  }

  /** Khoá booking rồi mới kiểm phạm vi/trạng thái (HB-093, BR-FO-05). */
  private async lockAndAuthorize(tx: Tx, actor: AuthorizedActor, bookingId: string) {
    const booking = await lockBooking(tx, bookingId);
    if (!actor.canActOn(booking.propertyId)) throw forbidden();
    if (booking.status !== CHECKED_IN) throw invalidState();
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
      lastNightAmount: await this.lastNightAmount(tx, booking.id, rooms, booking.checkOut),
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
    const housekeepingTaskIds = await this.ensureHousekeeping(tx, roomIds, businessDate, now);
    let refundRequestId: string | null = null;
    if (done.decision.earlyCheckout !== null) {
      const refund = await this.recordEarlyRefund(
        tx,
        actor,
        booking.id,
        done.paidAmount,
        done.unusedValue,
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
        feeAmount: done.decision.lateCheckOutFee,
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
      feeAmount: done.decision.lateCheckOutFee,
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
   * Giá đêm cuối theo nghĩa vụ ROOM đã chốt (BR-FO-03). Nghĩa vụ ROOM là bản sao bất biến của
   * snapshot giá tại thời điểm đặt, nên không đọc lại công thức giá ở đây.
   */
  private async lastNightAmount(
    tx: Tx,
    bookingId: string,
    rooms: readonly string[],
    checkOut: Date,
  ): Promise<number> {
    const lastNight = new Date(checkOut.getTime() - DAY).toISOString().slice(0, 10);
    const rows = await tx.$queryRaw<{ amount: bigint }[]>`
      SELECT coalesce(sum(amount - voided_amount), 0)::bigint AS amount
        FROM booking_charges
       WHERE booking_id = ${bookingId}::uuid AND kind = 'ROOM'
         AND booking_room_id = ANY(${[...rooms]}::uuid[])
         AND stay_date = ${lastNight}::date`;
    const amount = rows[0]!.amount;
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw internal();
    return Number(amount);
  }

  /**
   * BR-FO-05: phụ thu muộn và phát sinh là nghĩa vụ thật. Phụ thu ghi **một** dòng/booking; lần gọi
   * lại cập nhật số tiền khi chưa có phân bổ nào (khách vẫn đang ở nên mốc giờ có thể lên bậc).
   * Phát sinh khoá theo nội dung (`source_key`) nên gửi lại không ghi tiền hai lần.
   */
  private async recordObligations(
    tx: Tx,
    bookingId: string,
    fee: number,
    extras: readonly ExtraLine[],
    now: Date,
  ): Promise<void> {
    if (fee > 0)
      await tx.$executeRaw`
        INSERT INTO booking_charges(booking_id, kind, source_key, amount, reason, created_at, updated_at)
        VALUES(${bookingId}::uuid, 'EXTRA_SERVICE', ${FEE_SOURCE_KEY}, ${BigInt(fee)},
               'Phụ thu trả phòng muộn (BR-FO-03)', ${now}::timestamptz, ${now}::timestamptz)
        ON CONFLICT (booking_id, source_key) DO UPDATE
          SET amount = EXCLUDED.amount, updated_at = EXCLUDED.updated_at
          WHERE NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.charge_id = booking_charges.id)`;
    for (const line of extras)
      await tx.$executeRaw`
        INSERT INTO booking_charges(booking_id, kind, source_key, amount, reason, created_at, updated_at)
        VALUES(${bookingId}::uuid, 'EXTRA_SERVICE', ${line.key}, ${BigInt(line.amount)},
               ${line.description}, ${now}::timestamptz, ${now}::timestamptz)
        ON CONFLICT (booking_id, source_key) DO NOTHING`;
  }

  /**
   * BR-FO-06: đúng **một** nhiệm vụ PENDING cho mỗi phòng vật lý/ngày trả phòng. Khoá duy nhất
   * `(room_id, business_date)` là chốt chống trùng; nhiệm vụ đã có (kể cả do lượt trước) được dùng lại.
   */
  private async ensureHousekeeping(
    tx: Tx,
    roomIds: readonly string[],
    businessDate: Date,
    now: Date,
  ): Promise<string[]> {
    if (!roomIds.length) return [];
    const existing = await tx.housekeeping_tasks.findMany({
      where: { room_id: { in: [...roomIds] }, business_date: businessDate },
      select: { id: true, room_id: true },
    });
    const byRoom = new Map(existing.map((task) => [task.room_id, task.id]));
    const ids: string[] = [];
    for (const roomId of roomIds) {
      const found = byRoom.get(roomId);
      if (found) {
        ids.push(found);
        continue;
      }
      const task = await tx.housekeeping_tasks.create({
        data: {
          room_id: roomId,
          business_date: businessDate,
          status: 'PENDING',
          created_at: now,
          updated_at: now,
        },
        select: { id: true },
      });
      ids.push(task.id);
    }
    return ids;
  }

  /**
   * BR-CANCEL-09: hoàn của trả sớm do engine huỷ HB-053 quyết từ policy snapshot; tầng này chỉ
   * chuyển dữ kiện và ghi `RefundRequest` qua đúng đường `recordRefund` của F5. Booking vẫn
   * `CHECKED_OUT` — không gọi `closeBooking`/void nghĩa vụ phòng như huỷ booking.
   */
  private async recordEarlyRefund(
    tx: Tx,
    actor: AuthorizedActor,
    bookingId: string,
    paidAmount: bigint,
    unusedValue: bigint,
    businessNow: Date,
    now: Date,
    note: string | undefined,
  ) {
    if (unusedValue <= 0n) return null;
    const facts = await readFacts(tx, bookingId, true, paidAmount);
    const selected = facts.rooms
      .filter((room) => room.active)
      .map((room) => room.roomId)
      .sort();
    if (!selected.length) throw invalidState();
    const cap = paidAmount < unusedValue ? paidAmount : unusedValue;
    const decision = decide(
      { ...facts, receipts: capReceipts(facts.receipts, cap) },
      { state: 'CONFIRMED', forceMajeure: false, selected },
      businessNow.getTime(),
    );
    const request: CancelRequest = {
      reason: 'EARLY_CHECKOUT',
      isForceMajeure: false,
      bookingRoomIds: selected,
      ...(note === undefined ? {} : { note: maskOperationalText(note) }),
    };
    return recordRefund(tx, this.ledger, actor, facts, decision, request, selected, false, now);
  }
}
