/**
 * Use case đổi ngày lưu trú (HB-098, UC-BOOK-06) và xoá cứng `DRAFT`/`HELD` (UC-BOOK-05) — api.md §2.5.
 *
 * Thứ tự thi hành của `POST /bookings/{bookingId}/reschedule` (ADR-014, ADR-015 §7):
 * 1. `If-Match` là **bắt buộc** ⇒ thiếu `428`, lệch phiên bản `412` (api.md §1.3, §3.3);
 * 2. khoá `bookings` → `properties` → `room_types` → `rooms` rồi đọc dữ kiện (giờ CSDL, BR-BOOK-18);
 * 3. điều kiện BR-BOOK-12/13: trạng thái (chỉ `HELD`/`PENDING_PAYMENT` còn hạn hoặc `CONFIRMED` chưa
 *    nhận phòng), gói cho phép, `rescheduleCount < maxReschedules`, còn ≥ `rescheduleMinHours`;
 * 4. giá kỳ mới qua `stayPrice` (báo giá đã chấp nhận hoặc báo giá mới từ loader + engine — BR-RATE-17);
 * 5. nhả đơn vị bán **kỳ cũ** rồi để engine tồn HB-032/HB-076 chọn đơn vị cho kỳ mới (loại nhu cầu của
 *    chính booking khỏi phép kiểm trùng, BR-BOOK-12) — tất cả trong **một** transaction;
 * 6. `total = max(total cũ, giá kỳ mới)`; chênh tăng là nghĩa vụ tiền phòng, phí đổi là nghĩa vụ riêng;
 *    giá giảm **không** sinh hoàn và không hạ cam kết cũ (BR-BOOK-12/13, BR-CANCEL-08);
 * 7. append `PriceSnapshot` `RESCHEDULE` (**giữ** bản ORIGINAL), audit + outbox cùng transaction.
 *
 * `DELETE /bookings/{bookingId}` chỉ xoá cứng `DRAFT`/`HELD` **chưa** có khoản thanh toán nào; vết
 * `AuditLog.beforeJson` do trigger `trg_bookings_delete` ghi trước khi xoá (BR-BOOK-14/17).
 *
 * Quyền: hai tuyến là tuyến **nhân viên** (`@Permission` + `RbacGuard`); nhánh phiên khách của api.md
 * §2.5 chờ HB-017 — xem `permissions.ts` để biết vì sao `GUEST` chưa khai được.
 */
import type { Prisma as PrismaTypes, PrismaClient } from '@prisma/client';
import type { BookingSummary, ChannelCode } from '@pinehill/contracts';
import { channelCodeSchema } from '@pinehill/contracts';
import type { Clock } from '@pinehill/domain';
import type { UnitIdentity } from '@pinehill/domain/inventory';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import type { ApiConfig } from '../../../config/env.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { BookingLedger } from '../../pay/ledger/service.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { civilDay, dateOnly } from '../../rate/calendar/support.js';
import { RateQuoteService } from '../../rate/quotes/service.js';
import type { StoredQuote } from '../../rate/quotes/store.js';
import { bookingSelect, project } from '../bookings/projection.js';
import { planSnapshot } from '../bookings/snapshot.js';
import type { CommissionSetting, SnapshotSource } from '../bookings/snapshot.js';
import { overCapacity } from '../bookings/validation.js';
import { nominalCheckInMs } from '../cancel/context.js';
import { planHold } from '../holds/availability.js';
import { lockStock } from '../holds/lock.js';
import type { RescheduleFacts } from './context.js';
import { lockRescheduleFacts } from './context.js';
import { stayPrice } from './pricing.js';
import type { StayRequest } from './pricing.js';
import type { RescheduleInput } from './validation.js';
import {
  checkedIn,
  invalidDates,
  missing,
  notAllowed,
  stale,
  versionAnchor,
} from './validation.js';
import {
  announceReschedule,
  appendRescheduleSnapshot,
  hardDeleteBooking,
  insertAssignments,
  moveWindow,
  priceRooms,
  recordRescheduleCharges,
  releaseAssignments,
  rescheduleFee,
  safeAmount,
  safeError,
} from './writes.js';

type Tx = PrismaTypes.TransactionClient;

/** BR-BOOK-02: `checkIn` kỳ mới không xa hơn 365 ngày kể từ hôm nay. */
const MAX_LOOKAHEAD_DAYS = 365;
const HOUR_MS = 3_600_000;
/** BR-BOOK-12: mốc 168 giờ của lượt đổi đầu tính tới **kỳ cũ**, theo giờ nhận phòng danh nghĩa. */
const DEFAULT_REASON = 'Đổi ngày lưu trú (UC-BOOK-06).';

export class RescheduleService {
  private readonly ledger: BookingLedger;

  constructor(
    readonly db: PrismaClient,
    readonly quotes: RateQuoteService,
    readonly audit: AuditWriter,
    readonly config: ApiConfig,
    readonly clock: Clock,
  ) {
    this.ledger = new BookingLedger(clock);
  }

  /** Ngày nghiệp vụ (giờ VN) — BR-BOOK-02 so theo ngày VN, không theo UTC (cùng luật HB-077). */
  businessToday(): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.config.BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(this.clock.now());
    const segment = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${segment('year')}-${segment('month')}-${segment('day')}`;
  }

  /** Neo cho khoá chống trùng (HB-029): kiểm phiên, phạm vi cơ sở và sự tồn tại của booking trước. */
  async authorizeFor(db: PrismaClient, actor: AuthorizedActor, bookingId: string): Promise<void> {
    await this.authorize(db, actor, bookingId, false);
  }

  /**
   * Neo của lệnh xoá cứng: booking **đã biến mất** không phải lỗi của tiền kiểm — lệnh xoá đã commit
   * thì lần gửi lại cùng `Idempotency-Key` phải nhận lại kết quả cũ (api.md §1.6, §6.3 "retry idempotent
   * thành công được trả kết quả cũ sau kiểm quyền"), còn lệnh **mới** cho ID lạ vẫn `404` ở handler. Khoá
   * chống trùng gắn `principal_id` nên nhánh này không mở dữ liệu của người khác.
   */
  async authorizeForDelete(
    db: PrismaClient,
    actor: AuthorizedActor,
    bookingId: string,
  ): Promise<void> {
    await this.authorize(db, actor, bookingId, true);
  }

  /** BR-RBAC-02: phiên còn hiệu lực và còn phạm vi cơ sở của booking (OWNER toàn chuỗi). */
  private async authorize(
    tx: Tx,
    actor: AuthorizedActor,
    bookingId: string,
    tolerateMissing: boolean,
  ): Promise<void> {
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
    if (booking === null) {
      if (tolerateMissing) return;
      throw missing();
    }
    const scoped =
      user.role === 'OWNER' ||
      user.user_property_scopes.some((scope) => scope.property_id === booking.property_id);
    if (!scoped) throw new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Booking ngoài phạm vi cơ sở.');
  }

  /** BR-BOOK-02: kỳ mới không ở quá khứ và không xa hơn 365 ngày kể từ hôm nay (giờ VN). */
  private assertWindow(checkIn: string): void {
    const today = this.businessToday();
    if (checkIn < today || civilDay(checkIn) - civilDay(today) > MAX_LOOKAHEAD_DAYS)
      throw invalidDates();
  }

  /**
   * BR-BOOK-12/13/18. Thứ tự kiểm: trạng thái và hạn giữ chỗ trước (để `404`/`403`/`409` không bị neo
   * cũ che mất — cùng luật HB-097), rồi gói giá/số lần/mốc giờ, sau cùng mới tới `If-Match`.
   */
  private assertReschedulable(
    facts: RescheduleFacts,
    version: bigint,
    input: RescheduleInput,
  ): void {
    this.assertState(facts);
    if (facts.version !== version) throw stale();
    this.assertWindow(input.checkIn);
  }

  /** Trạng thái cho phép đổi ngày, hạn giữ chỗ theo giờ CSDL, gói giá, số lần và mốc 168 giờ. */
  private assertState(facts: RescheduleFacts): void {
    this.assertWaitingState(facts);
    this.assertPlanAllows(facts);
  }

  /** BR-BOOK-12/13/18: trạng thái cho phép và hạn giữ chỗ đọc bằng **giờ CSDL** sau khoá. */
  private assertWaitingState(facts: RescheduleFacts): void {
    if (facts.status === 'CHECKED_IN') throw checkedIn();
    const waiting = facts.status === 'HELD' || facts.status === 'PENDING_PAYMENT';
    if (!waiting && facts.status !== 'CONFIRMED')
      throw notAllowed(`Đặt phòng ở trạng thái ${facts.status} không đổi ngày được (BR-BOOK-12).`);
    // Hết hạn thì job HB-078 là bên duy nhất kết thúc hold.
    if (waiting && (facts.holdExpiresAt === null || facts.now >= facts.holdExpiresAt))
      throw notAllowed('Giữ chỗ đã hết hạn; hãy tạo đặt phòng mới (BR-BOOK-18).');
  }

  /** BR-BOOK-12/BR-RATE-20: gói cho phép, chưa hết số lần, và còn đủ mốc giờ trước kỳ cũ. */
  private assertPlanAllows(facts: RescheduleFacts): void {
    if (!facts.plan.rescheduleAllowed)
      throw notAllowed('Gói giá của đặt phòng không cho phép đổi ngày.');
    if (facts.rescheduleCount >= facts.plan.maxReschedules)
      throw notAllowed(
        'Đã dùng hết số lần đổi ngày; hãy huỷ rồi đặt lại đặt phòng mới (BR-BOOK-12).',
      );
    const hours =
      (nominalCheckInMs(facts.checkIn, facts.stay.checkInTime, facts.stay.timezone) -
        facts.now.getTime()) /
      HOUR_MS;
    if (hours < facts.plan.rescheduleMinHours)
      throw notAllowed(
        `Còn dưới ${facts.plan.rescheduleMinHours} giờ trước kỳ cũ; hãy xử lý như huỷ rồi đặt mới (BR-BOOK-12).`,
      );
  }

  /** Kênh bán của booking phải nằm trong enum hợp đồng (dữ liệu do HB-077 ghi, nhưng không tin ngầm). */
  private channelCode(value: string): ChannelCode {
    const parsed = channelCodeSchema.safeParse(value);
    if (!parsed.success)
      throw new AppError(
        422,
        'E_RATE_CONFIGURATION_INVALID',
        'Kênh bán của đặt phòng không nằm trong hợp đồng kênh.',
      );
    return parsed.data;
  }

  async reschedule(
    tx: Tx,
    actor: AuthorizedActor,
    bookingId: string,
    input: RescheduleInput,
    tag: unknown,
  ): Promise<BookingSummary> {
    try {
      const version = versionAnchor(tag);
      await this.authorize(tx, actor, bookingId, false);
      const facts = await lockRescheduleFacts(tx, bookingId);
      this.assertReschedulable(facts, version, input);
      const stay: StayRequest = {
        propertyId: facts.propertyId,
        roomTypeId: facts.roomTypeId,
        channelCode: this.channelCode(facts.channelCode),
        ratePlanCode: facts.plan.code,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        adults: facts.adults,
        children: facts.children,
        roomCount: facts.roomCount,
      };
      const offer = await stayPrice(
        tx,
        this.quotes,
        { type: 'USER', id: actor.id },
        stay,
        input.quoteId,
      );
      const stock = await lockStock(tx, facts.propertyId, facts.roomTypeId);
      if (stock.capacityAdults * facts.roomCount < facts.adults + facts.children)
        throw overCapacity();
      // Nhả kỳ cũ **trước** khi kiểm tồn: nhu cầu của chính booking không được tính là chỗ đã dùng
      // (BR-BOOK-12), và mọi thứ nằm trong một transaction nên lỗi phía sau rollback cả hai bước.
      const released = await releaseAssignments(
        tx,
        facts.rooms.map((room) => room.id),
        'RESCHEDULE',
        facts.now,
      );
      const plan = await planHold(tx, {
        propertyId: facts.propertyId,
        roomTypeId: facts.roomTypeId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        channelCode: stay.channelCode,
        roomCount: facts.roomCount,
      });
      return await this.apply(tx, actor, facts, input, offer, plan.units, released);
    } catch (error) {
      safeError(error);
    }
  }

  private async apply(
    tx: Tx,
    actor: AuthorizedActor,
    facts: RescheduleFacts,
    input: RescheduleInput,
    offer: StoredQuote,
    units: readonly UnitIdentity[],
    released: number,
  ): Promise<BookingSummary> {
    const { quote } = offer;
    const offered = BigInt(quote.total);
    // BR-BOOK-12: `newTotal = max(oldTotal, giá kỳ mới)`; giá giảm **không** hạ cam kết đã bán.
    const totalAmount = offered > facts.totalAmount ? offered : facts.totalAmount;
    const increase = totalAmount - facts.totalAmount;
    const retained = offered < facts.totalAmount ? facts.totalAmount - offered : 0n;
    // BR-CANCEL-07/BR-BOOK-12: phí đổi theo tỷ lệ của gói (NONREF 10%, các gói khác 0) trên tổng cũ.
    const fee = rescheduleFee(facts.plan.rescheduleFeePct, facts.totalAmount);
    const reason = input.reason === null ? DEFAULT_REASON : maskOperationalText(input.reason);
    const roomIds = facts.rooms.map((room) => room.id);
    const source: SnapshotSource = {
      quote,
      quoteId: quote.quoteId,
      quoteFingerprint: offer.fingerprint,
      channelCode: facts.channelCode,
      ratePlan: {
        id: facts.plan.id,
        code: facts.plan.code,
        minNights: facts.plan.minNights,
        maxNights: facts.plan.maxNights,
        losDiscountEnabled: facts.plan.losDiscountEnabled,
        depositPercent: facts.plan.depositPercent,
      },
      // ADR-015 §7: giữ **policy hợp đồng gốc**, không đọc cấu hình live lúc đổi ngày.
      policy: facts.policy,
      stay: {
        timezone: facts.stay.timezone,
        checkInTime: facts.stay.checkInTime,
        checkOutTime: facts.stay.checkOutTime,
      },
      settings: await this.channelSettings(tx, facts.channelId, facts.propertyId, input.checkOut),
      roomCount: facts.roomCount,
    };
    const planned = planSnapshot(source);
    const moved = await moveWindow(tx, {
      bookingId: facts.id,
      expectedVersion: facts.version,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      totalAmount,
      now: facts.now,
    });
    await priceRooms(tx, facts.rooms, planned, facts.now);
    await insertAssignments(tx, roomIds, units, input.checkIn, input.checkOut, facts.now);
    await appendRescheduleSnapshot(tx, {
      bookingId: facts.id,
      sequence: facts.snapshotSeq + 1,
      source,
      plan: planned,
      roomIds,
      policyJson: facts.policyJson,
      previous: {
        checkIn: facts.checkIn,
        checkOut: facts.checkOut,
        totalAmount: facts.totalAmount,
        rescheduleCount: facts.rescheduleCount,
      },
      increase,
      retained,
      fee,
      reason,
      now: facts.now,
    });
    const charges = await recordRescheduleCharges(tx, {
      bookingId: facts.id,
      roomIds,
      plan: planned,
      increase,
      fee,
      rescheduleCount: moved.count,
      reason,
      now: facts.now,
    });
    // BR-PAY-02: số dư là projection của sổ nghĩa vụ/phân bổ, không tự cộng trừ trên `bookings`.
    await this.ledger.sync(tx, facts.id, actor);
    await this.audit.record(tx, {
      actor,
      action: 'BOOKING_RESCHEDULED',
      entityType: 'Booking',
      entityId: facts.id,
      beforeJson: {
        propertyId: facts.propertyId,
        checkIn: facts.checkIn,
        checkOut: facts.checkOut,
        totalAmount: safeAmount(facts.totalAmount),
        rescheduleCount: facts.rescheduleCount,
        version: safeAmount(facts.version),
      },
      afterJson: {
        propertyId: facts.propertyId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        totalAmount: safeAmount(totalAmount),
        offeredTotal: quote.total,
        balanceIncrease: safeAmount(increase),
        retainedAmount: safeAmount(retained),
        feeAmount: safeAmount(fee),
        rescheduleFeeChargeId: charges.feeChargeId,
        rescheduleCount: moved.count,
        version: safeAmount(moved.version),
        quoteId: quote.quoteId,
        engineVersion: quote.engineVersion,
        releasedAssignmentCount: released,
        bookingRoomIds: roomIds,
        assignedRoomIds: units.map((unit) => unit.roomId),
      },
      reason,
    });
    await announceReschedule(tx, {
      bookingId: facts.id,
      propertyId: facts.propertyId,
      roomTypeId: facts.roomTypeId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      units,
    });
    const row = await tx.bookings.findUniqueOrThrow({
      where: { id: facts.id },
      select: bookingSelect,
    });
    return project(row);
  }

  /** Hoạt động hoa hồng của kênh tại cơ sở theo `effective_from` — cùng luật ảnh giá HB-077. */
  private async channelSettings(
    tx: Tx,
    channelId: string,
    propertyId: string,
    checkOut: string,
  ): Promise<CommissionSetting[]> {
    const rows = await tx.channel_property_settings.findMany({
      where: {
        channel_id: channelId,
        property_id: propertyId,
        effective_from: { lte: new Date(`${checkOut}T00:00:00.000Z`) },
      },
      orderBy: { effective_from: 'asc' },
      select: { id: true, commission_pct: true, effective_from: true },
    });
    return rows.map((row) => ({
      id: row.id,
      commissionPercent: Number(row.commission_pct),
      effectiveFrom: dateOnly(row.effective_from),
    }));
  }

  /** BR-BOOK-14/17: xoá cứng `DRAFT`/`HELD` chưa phát sinh thanh toán; vết kiểm toán do trigger ghi. */
  async hardDelete(
    tx: Tx,
    actor: AuthorizedActor,
    bookingId: string,
    reason: string,
  ): Promise<void> {
    try {
      // Trong handler booking **phải** tồn tại: `404` cho ID lạ, còn lần gửi lại cùng khoá đã được
      // `IdempotencyStore` phát lại trước khi tới đây (HB-029, api.md §1.6).
      await this.authorize(tx, actor, bookingId, false);
      await hardDeleteBooking(tx, { bookingId, reason: maskOperationalText(reason), actor });
    } catch (error) {
      safeError(error);
    }
  }
}
