/**
 * Ghi nhận khách không đến (HB-147; UC-FO-04; BR-CANCEL-10, BR-CANCEL-06, BR-FO-02).
 *
 * Một transaction của `IdempotencyStore`: khoá booking (ADR-014) → kiểm trạng thái + mốc 23:59 → quyết
 * định tiền bằng **engine huỷ** `@pinehill/domain` qua `book/cancel/engine.ts` (không chép công thức
 * bậc/phạt) → nhả phân công, void nghĩa vụ phòng, ghi công nợ `PENALTY`, đổi trạng thái + history +
 * audit + outbox. Lần gọi lại (cùng khoá hay khoá mới) thấy `status <> CONFIRMED` nên bị chặn ⇒ không
 * bao giờ sinh khoản thứ hai.
 *
 * Phạt đêm đầu giữ **nguyên** định nghĩa BR-CANCEL-06 ở `recordPenalty` của `book/cancel/writes.ts`
 * (`booking_charges` PENALTY + `payments` PENALTY PENDING + chiếu `penalty_amount`), và chiếu số dư do
 * `BookingLedger` tính — không tự cộng trừ tiền ở tầng này.
 *
 * Mốc giờ: quyết định đọc **sau khi khoá** booking. Mốc 23:59 so bằng cổng `CLOCK` (harness khoá HB-143
 * giả lập giờ nghiệp vụ qua cổng này); ở production `SystemClock` đọc đồng hồ hệ thống nên bằng
 * `clock_timestamp()`. Cùng một mốc được dùng cho history/audit/outbox để một transaction chỉ có một
 * thời điểm quyết định.
 */
import type { PrismaClient } from '@prisma/client';
import { DomainError } from '@pinehill/domain';
import type { Clock } from '@pinehill/domain';
import { noShowPreviewSchema, noShowResponseSchema } from '@pinehill/contracts';
import type {
  NoShowPreview,
  NoShowPreviewRequest,
  NoShowRequest,
  NoShowResponse,
} from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { BookingLedger } from '../../pay/ledger/service.js';
import { nominalCheckInMs, readFacts } from '../../book/cancel/context.js';
import type { CancelDecision, CancelFacts } from '../../book/cancel/context.js';
import { decide } from '../../book/cancel/engine.js';
import {
  recordPenalty,
  releaseAssignments,
  safeAmount,
  voidRoomCharges,
  type Tx,
} from '../../book/cancel/writes.js';
import { invalidState, missing, NO_SHOW_MARK_TIME, NO_SHOW_REASON } from './validation.js';

/** Sự kiện cổng ra cùng loại với luồng huỷ/giữ chỗ (`InventoryChanged`, HB-076/078). */
const INVENTORY_EVENT = 'InventoryChanged';

export class NoShowService {
  private readonly ledger: BookingLedger;

  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly audit: AuditWriter,
  ) {
    this.ledger = new BookingLedger(clock);
  }

  /** Neo cho khoá chống trùng: kiểm phiên, phạm vi cơ sở và sự tồn tại của booking trước khi giữ khoá. */
  async authorizeFor(db: PrismaClient, actor: AuthorizedActor, bookingId: string): Promise<void> {
    await this.authorize(db, actor, bookingId);
  }

  async mark(tx: Tx, actor: AuthorizedActor, input: NoShowRequest): Promise<NoShowResponse> {
    const { facts, projection, milestone } = await this.assess(tx, actor, input.bookingId);
    const now = this.clock.now();
    if (now.getTime() < milestone)
      throw invalidState('Chưa tới 23:59 ngày nhận phòng nên chưa được ghi nhận không đến.');
    const selected = this.selection(facts);
    const decision = this.decide(facts, selected, now.getTime());
    const inventory = await this.inventoryRooms(tx, facts.id);
    const released = await releaseAssignments(tx, selected, NO_SHOW_REASON, now);
    await voidRoomCharges(tx, facts.id, selected, NO_SHOW_REASON, now);
    const penaltyId =
      decision.penalty > 0n
        ? await recordPenalty(tx, facts, decision, selected, actor.id, now)
        : null;
    const remainingTotal = await this.closeStay(tx, facts, input.reason, actor.id, now);
    await this.ledger.sync(tx, facts.id, actor);
    await this.audit.record(tx, {
      actor,
      action: 'BOOKING_NO_SHOW',
      entityType: 'Booking',
      entityId: facts.id,
      beforeJson: {
        propertyId: facts.propertyId,
        status: facts.status,
        version: safeAmount(facts.version),
        paidAmount: safeAmount(projection.paidAmount),
      },
      afterJson: {
        propertyId: facts.propertyId,
        status: 'NO_SHOW',
        markedAt: now.toISOString(),
        releasedAssignmentCount: released,
        releasedRoomIds: inventory.roomIds,
        refundPercent: decision.refundPercent,
        penaltyAmount: safeAmount(decision.penalty),
        penaltyChargeId: penaltyId,
        remainingTotalAmount: safeAmount(remainingTotal),
        refundRequestId: null,
      },
      reason: maskOperationalText(input.reason),
    });
    await tx.outbox_events.create({
      data: {
        event_type: INVENTORY_EVENT,
        aggregate_type: 'Booking',
        aggregate_id: facts.id,
        payload_json: {
          propertyId: facts.propertyId,
          roomTypeId: inventory.roomTypeId,
          startDate: facts.checkIn,
          endDate: facts.payload.stay.checkOut,
          roomIds: inventory.roomIds,
          operation: 'BOOKING_NO_SHOW',
        },
      },
    });
    return noShowResponseSchema.parse({
      bookingId: facts.id,
      status: 'NO_SHOW',
      markedAt: now.toISOString(),
      penaltyAmount: safeAmount(decision.penalty),
      refundRequestId: null,
    });
  }

  /**
   * Xem trước tiền no-show (HB-209, TD-28): cùng `assess` + cùng `decide` của engine huỷ như lệnh ghi,
   * **không ghi gì** (chỉ khoá đọc theo ADR-014). Trước 23:59 lệnh ghi bị từ chối, nên số xem trước được
   * tính tại chính mốc 23:59 (`markableFrom`) — bậc bắt tất mà lệnh ghi sẽ áp; từ mốc trở đi dùng `now`
   * như lệnh ghi. `expectedRefundAmount` = 0: lệnh ghi không tạo yêu cầu hoàn (`refundRequestId` luôn
   * `null`), nên số xem trước không hứa khoản hoàn mà lệnh ghi không thực hiện.
   */
  async preview(actor: AuthorizedActor, input: NoShowPreviewRequest): Promise<NoShowPreview> {
    return this.db.$transaction(
      async (tx) => {
        const { facts, milestone } = await this.assess(tx, actor, input.bookingId);
        const now = this.clock.now();
        const decision = this.decide(
          facts,
          this.selection(facts),
          Math.max(now.getTime(), milestone),
        );
        return noShowPreviewSchema.parse({
          bookingId: facts.id,
          penaltyAmount: safeAmount(decision.penalty),
          expectedRefundAmount: 0,
          markableFrom: new Date(milestone).toISOString(),
          computedAt: now.toISOString(),
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  /**
   * Phần dùng chung của lệnh ghi và xem trước: phạm vi → sổ cái (khoá booking → payments → refund_requests)
   * → dữ kiện huỷ → trạng thái `CONFIRMED` → mốc 23:59 ngày nhận phòng theo múi giờ của snapshot.
   */
  private async assess(tx: Tx, actor: AuthorizedActor, bookingId: string) {
    await this.authorize(tx, actor, bookingId);
    const projection = await this.ledger.read(tx, bookingId);
    const facts = await readFacts(tx, bookingId, true, projection.paidAmount);
    if (facts.status !== 'CONFIRMED')
      throw invalidState('Chỉ booking CONFIRMED mới ghi nhận được khách không đến.');
    const milestone = nominalCheckInMs(
      facts.checkIn,
      NO_SHOW_MARK_TIME,
      facts.payload.stay.timezone,
    );
    return { facts, projection, milestone };
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
    const scoped =
      user.role === 'OWNER' ||
      user.user_property_scopes.some((scope) => scope.property_id === booking.property_id);
    if (!scoped) throw new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Booking ngoài phạm vi cơ sở.');
  }

  /** Không đến là toàn bộ đơn: mọi BookingRoom còn hoạt động (đơn đã huỷ một phần thì phần còn lại). */
  private selection(facts: CancelFacts): string[] {
    const active = facts.rooms
      .filter((room) => room.active)
      .map((room) => room.roomId)
      .sort();
    if (!active.length)
      throw invalidState('Booking không còn phòng hoạt động để ghi nhận không đến.');
    return active;
  }

  /**
   * Quyết định của engine huỷ với `now` đã qua mốc ⇒ `resolveTier` luôn chọn bậc bắt tất −1 của
   * chính sách hiện hành trong `PriceSnapshot` (BR-CANCEL-10). Không tự đọc/áp lại bảng bậc ở đây.
   */
  private decide(facts: CancelFacts, selected: readonly string[], nowMs: number): CancelDecision {
    try {
      return decide(facts, { state: 'CONFIRMED', forceMajeure: false, selected }, nowMs);
    } catch (error) {
      if (error instanceof DomainError)
        throw invalidState('Không đọc được chính sách huỷ của booking để tính phụ thu đêm đầu.');
      throw error;
    }
  }

  /**
   * Phòng thực tế đang gán của booking — cần cho `outbox_events.roomIds` sau khi nhả phân công, và
   * `roomTypeId` cho cùng payload tồn kho như luồng giữ chỗ/hết hạn.
   */
  private async inventoryRooms(
    tx: Tx,
    bookingId: string,
  ): Promise<{ roomTypeId: string; roomIds: string[] }> {
    const booking = await tx.bookings.findUniqueOrThrow({
      where: { id: bookingId },
      select: { room_type_id: true },
    });
    const rows = await tx.$queryRaw<{ room_id: string }[]>`
      SELECT a.room_id FROM room_assignments a
        JOIN booking_rooms br ON br.id = a.booking_room_id
       WHERE br.booking_id = ${bookingId}::uuid AND a.released_at IS NULL
       ORDER BY a.room_id`;
    return { roomTypeId: booking.room_type_id, roomIds: rows.map((row) => row.room_id) };
  }

  /**
   * Đóng phần ở còn lại (BR-CANCEL-10/BK-CANCEL-19): giá trị các đêm đã void về 0, trạng thái `NO_SHOW`,
   * một dòng `booking_status_history`. `total_amount` tính từ chính `booking_charges` như `closeBooking`
   * của luồng huỷ để hai đường không lệch nhau.
   */
  private async closeStay(
    tx: Tx,
    facts: CancelFacts,
    reason: string,
    actorId: string,
    now: Date,
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<{ total_amount: bigint }[]>`
      UPDATE bookings SET
        total_amount = (SELECT coalesce(sum(amount - voided_amount), 0) FROM booking_charges
                         WHERE booking_id = ${facts.id}::uuid AND kind = 'ROOM'),
        status = 'NO_SHOW',
        cancel_reason = ${NO_SHOW_REASON},
        cancelled_at = ${now}::timestamptz,
        updated_at = ${now}::timestamptz,
        version = version + 1
       WHERE id = ${facts.id}::uuid
      RETURNING total_amount`;
    await tx.booking_status_history.create({
      data: {
        booking_id: facts.id,
        from_status: facts.status,
        to_status: 'NO_SHOW',
        reason,
        actor_id: actorId,
        at: now,
      },
    });
    return rows[0]!.total_amount;
  }
}
