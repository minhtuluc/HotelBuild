/**
 * Use case đặt phòng (HB-077; UC-BOOK-01, api.md §2.5, §3.2) — bốn tuyến:
 * `POST /bookings`, `POST /bookings/{bookingId}/confirm`, `GET /bookings`, `GET /bookings/{bookingId}`.
 *
 * Thứ tự thi hành `POST /bookings` (ADR-014, ADR-015 §2):
 * 1. khoá tài nguyên theo thứ tự `properties → room_types → rooms` (`lock.ts`, hàng idempotency đã bị
 *    `IdempotencyStore` khoá trước đó) rồi kiểm sức chứa (BR-BOOK-04);
 * 2. **sau khi khoá** mới tiêu thụ quote (HB-074) — nguồn ngày/tiền duy nhất, không tính lại giá
 *    (BR-RATE-17) — và kiểm "một quote một booking" (AC1);
 * 3. nghi trùng (BR-BOOK-16) trả booking cũ kèm `duplicateSuspected`;
 * 4. kiểm tồn bằng engine HB-032 **sau** khoá (`planHold` của HB-076), hạn giữ chỗ theo **giờ CSDL**
 *    cộng `channels.hold_minutes` (BR-BOOK-07);
 * 5. ghi booking + `booking_rooms` + assignment + `price_snapshots` ORIGINAL + `booking_charges` ROOM +
 *    history + audit + outbox trong **một** transaction (`writes.ts`).
 *
 * `confirm` (AC3) khoá booking rồi đọc trạng thái/hạn bằng **giờ CSDL**: chỉ `HELD`/`PENDING_PAYMENT`
 * **còn hạn** và **đã đủ cọc** mới chuyển `CONFIRMED`; hết hạn ⇒ lỗi và **không** đổi trạng thái
 * (BR-BOOK-18), để job hết hạn (HB-078) là bên duy nhất kết thúc hold.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { BookingSummary, BookingsQuery, ListPage } from '@pinehill/contracts';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import type { ApiConfig } from '../../../config/env.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { assertGuestNotBlacklisted } from '../../crm/guests/blacklist.js';
import { civilDay, dateOnly } from '../../rate/calendar/support.js';
import { RateQuoteService } from '../../rate/quotes/service.js';
import { planHold } from '../holds/availability.js';
import { findDuplicateBooking } from './duplicate.js';
import type { DuplicateBooking } from './duplicate.js';
import { inventoryError, lockBooking, lockStock } from './lock.js';
import { loadPolicySnapshot } from './policy.js';
import { requireBookingRead, requireConfirm, requireCreate, requireRead } from './principal.js';
import type { BookingCaller } from './principal.js';
import { bookingSelect, listBookings, project } from './projection.js';
import type { CommissionSetting, SnapshotStay } from './snapshot.js';
import {
  bookingInput,
  depositNotCollected,
  duplicateUnverified,
  invalidDates,
  invalidState,
  missing,
  overCapacity,
  quoteAlreadyAccepted,
} from './validation.js';
import type { BookingInput } from './validation.js';
import { confirmBooking, flagDuplicateSuspected, insertBooking } from './writes.js';

type Tx = Prisma.TransactionClient;

/**
 * BR-BOOK-07 + Q-13: kênh `holdMinutes = 0` (WALKIN, các OTA) **bỏ qua** `HELD`; khách vãng lai chưa đủ
 * tiền dùng `PENDING_PAYMENT` với hạn 15 phút, còn OTA đã thu tiền đi theo đường adapter của kênh
 * (HB-129). `PENDING_PAYMENT` vẫn cần `hold_expires_at` (`ck_bookings_hold`) và vẫn bị job hết hạn
 * (HB-078) quét như mọi trạng thái chờ.
 */
export const PENDING_PAYMENT_MINUTES = 15;

/** BR-BOOK-02: `checkIn` không xa hơn 365 ngày kể từ hôm nay. */
const MAX_LOOKAHEAD_DAYS = 365;

/** `use case` trả `created = false` khi BR-BOOK-16 trả lại booking đã có (200 thay vì 201). */
export interface BookingCreationResult {
  readonly created: boolean;
  readonly booking: BookingSummary;
}

/** Snapshot đã chốt của quote trong DB (AC1) — retry với khoá idempotency **mới** vẫn là lệnh mới. */
function quoteTaken(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  const target = error.meta?.target;
  return Array.isArray(target) && target.includes('quote_id');
}

/** BR-BOOK-06: chỉ hai trạng thái chờ mới xác nhận được. */
function pendingState(status: string): 'HELD' | 'PENDING_PAYMENT' {
  if (status === 'HELD' || status === 'PENDING_PAYMENT') return status;
  throw invalidState('Chỉ xác nhận được đặt phòng đang giữ chỗ hoặc chờ thanh toán.');
}

@Injectable()
export class BookingsService {
  constructor(
    readonly db: PrismaClient,
    readonly quotes: RateQuoteService,
    readonly permissions: PermissionRegistry,
    readonly audit: AuditWriter,
    readonly config: ApiConfig,
    readonly clock: Clock,
  ) {}

  /** Ngày nghiệp vụ (giờ VN) của `Clock` tiêm — BR-BOOK-02 so theo ngày VN, không theo UTC. */
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

  private assertWindow(input: BookingInput): void {
    const today = this.businessToday();
    if (input.checkIn < today) throw invalidDates();
    if (civilDay(input.checkIn) - civilDay(today) > MAX_LOOKAHEAD_DAYS) throw invalidDates();
  }

  /**
   * Chủ sở hữu booking: phiên khách luôn là chính khách của phiên; nhân viên thì tra hồ sơ theo SĐT đã
   * chuẩn hoá (BR-CRM-01) và tạo mới nếu chưa có. Hồ sơ trong danh sách đen chặn tạo booking
   * (BR-BOOK-15, BR-CRM-04).
   */
  private async resolveGuest(tx: Tx, caller: BookingCaller, input: BookingInput): Promise<string> {
    if (caller.type === 'GUEST') {
      await assertGuestNotBlacklisted(tx, caller.id);
      return caller.id;
    }
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO guests(full_name,phone) VALUES(${input.guest.fullName},${input.guest.phone})
      ON CONFLICT (phone) WHERE anonymized_at IS NULL DO NOTHING
      RETURNING id`;
    const guestId =
      inserted[0]?.id ??
      (
        await tx.guests.findFirstOrThrow({
          where: { phone: input.guest.phone, anonymized_at: null },
          select: { id: true },
        })
      ).id;
    await assertGuestNotBlacklisted(tx, guestId);
    return guestId;
  }

  /** AC1: ràng buộc UNIQUE `price_snapshots.quote_id` phải được kiểm **trước** khi ghi booking. */
  private async assertQuoteUnused(tx: Tx, quoteId: string): Promise<void> {
    const used = await tx.price_snapshots.findUnique({
      where: { quote_id: quoteId },
      select: { id: true },
    });
    if (used !== null) throw quoteAlreadyAccepted();
  }

  /**
   * BR-BOOK-16: trả **booking cũ** kèm cờ nghi trùng. Khách chỉ nhận booking của chính mình; trùng
   * nhưng khác chủ sở hữu ⇒ `409` không lộ nội dung/mã của người khác (yêu cầu nhân viên xác minh).
   */
  private async reportDuplicate(
    tx: Tx,
    caller: BookingCaller,
    duplicate: DuplicateBooking,
  ): Promise<BookingCreationResult> {
    if (caller.type === 'GUEST' && duplicate.guestId !== caller.id) throw duplicateUnverified();
    await flagDuplicateSuspected(tx, this.audit, {
      bookingId: duplicate.id,
      propertyId: duplicate.propertyId,
      caller,
    });
    const row = await tx.bookings.findUniqueOrThrow({
      where: { id: duplicate.id },
      select: bookingSelect,
    });
    return { created: false, booking: project(row) };
  }

  private async stayTimes(tx: Tx, propertyId: string): Promise<SnapshotStay> {
    const rows = await tx.$queryRaw<
      { timezone: string; check_in_time: string; check_out_time: string }[]
    >`SELECT timezone, to_char(check_in_time, 'HH24:MI') AS check_in_time,
             to_char(check_out_time, 'HH24:MI') AS check_out_time
        FROM properties WHERE id=${propertyId}::uuid`;
    const row = rows[0];
    if (row === undefined) throw missing();
    return {
      timezone: row.timezone,
      checkInTime: row.check_in_time,
      checkOutTime: row.check_out_time,
    };
  }

  /** Hoạt động hoa hồng của kênh tại cơ sở, theo `effective_from` — ADR-015 §4 (settingId/version). */
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

  async create(tx: Tx, caller: BookingCaller, body: unknown): Promise<BookingCreationResult> {
    const input = bookingInput(body);
    requireCreate(this.permissions, caller, input.propertyId);
    this.assertWindow(input);
    try {
      const stock = await lockStock(tx, input.propertyId, input.roomTypeId);
      if (stock.capacityAdults * input.roomCount < input.adults + input.children)
        throw overCapacity();
      const channel = await tx.channels.findUnique({
        where: { code: input.channelCode },
        select: { id: true, hold_minutes: true },
      });
      if (channel === null) throw missing();
      // ADR-015 §2: sau khoá mới đọc quote; fingerprint/principal/hạn do HB-074 quyết.
      const stored = await this.quotes.consume(input.quoteId, caller.principal, body);
      await this.assertQuoteUnused(tx, input.quoteId);
      const guestId = await this.resolveGuest(tx, caller, input);
      const duplicate = await findDuplicateBooking(tx, {
        channelId: channel.id,
        roomTypeId: input.roomTypeId,
        checkIn: input.checkIn,
        guestId,
        phone: input.guest.phone,
      });
      if (duplicate !== null) return this.reportDuplicate(tx, caller, duplicate);
      const plan = await planHold(tx, input);
      const ratePlan = await tx.rate_plans.findUnique({
        where: { code: input.ratePlanCode },
        select: {
          id: true,
          code: true,
          min_nights: true,
          max_nights: true,
          los_discount_enabled: true,
          deposit_percent: true,
          cancellation_policy_id: true,
        },
      });
      if (ratePlan === null) throw missing();
      const policy = await loadPolicySnapshot(tx, ratePlan.cancellation_policy_id);
      const now = plan.facts.now;
      const holdExpiresAt = new Date(
        now.getTime() +
          (channel.hold_minutes > 0 ? channel.hold_minutes : PENDING_PAYMENT_MINUTES) * 60_000,
      );
      const written = await insertBooking(tx, this.audit, {
        input,
        caller,
        quote: stored.quote,
        quoteId: input.quoteId,
        quoteFingerprint: stored.fingerprint,
        status: channel.hold_minutes > 0 ? 'HELD' : 'PENDING_PAYMENT',
        holdExpiresAt,
        ratePlanId: ratePlan.id,
        channelId: channel.id,
        guestId,
        units: plan.units,
        now,
        snapshotSource: {
          quote: stored.quote,
          quoteId: input.quoteId,
          quoteFingerprint: stored.fingerprint,
          channelCode: input.channelCode,
          roomCount: input.roomCount,
          ratePlan: {
            id: ratePlan.id,
            code: ratePlan.code,
            minNights: ratePlan.min_nights,
            maxNights: ratePlan.max_nights,
            losDiscountEnabled: ratePlan.los_discount_enabled,
            depositPercent: Number(ratePlan.deposit_percent),
          },
          policy,
          stay: await this.stayTimes(tx, input.propertyId),
          settings: await this.channelSettings(tx, channel.id, input.propertyId, input.checkOut),
        },
      });
      const row = await tx.bookings.findUniqueOrThrow({
        where: { id: written.id },
        select: bookingSelect,
      });
      return { created: true, booking: project(row) };
    } catch (error) {
      if (quoteTaken(error)) throw quoteAlreadyAccepted();
      inventoryError(error);
    }
  }

  /**
   * AC3/BR-BOOK-18: khoá booking rồi đọc trạng thái/hạn bằng **giờ CSDL**; `now ≥ holdExpiresAt` ⇒ lỗi và
   * **không** chạm trạng thái (job hết hạn HB-078 là bên kết thúc hold). BR-BOOK-09: cần chứng từ thu
   * thành công và tiền phòng đã thu đạt `depositAmount`.
   */
  async confirm(
    tx: Tx,
    caller: BookingCaller,
    bookingId: string,
    paymentId: string,
  ): Promise<BookingSummary> {
    const target = await tx.bookings.findUnique({
      where: { id: bookingId },
      select: { property_id: true },
    });
    if (target === null) throw missing();
    requireConfirm(this.permissions, caller, { propertyId: target.property_id });
    const booking = await lockBooking(tx, bookingId);
    const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
    const fromStatus = pendingState(booking.status);
    if (booking.holdExpiresAt === null || booking.holdExpiresAt.getTime() <= now.getTime())
      throw invalidState('Hold đã hết hạn theo giờ hệ thống; không thể xác nhận.');
    const payment = await tx.payments.findFirst({
      where: { id: paymentId, booking_id: bookingId },
      select: { id: true, status: true, type: true },
    });
    if (payment === null) throw missing();
    if (
      payment.status !== 'SUCCEEDED' ||
      (payment.type !== 'DEPOSIT' && payment.type !== 'BALANCE')
    )
      throw invalidState('Khoản thu dẫn ra chưa được ghi nhận thành công.');
    const collected = await tx.payments.aggregate({
      where: { booking_id: bookingId, status: 'SUCCEEDED', type: { in: ['DEPOSIT', 'BALANCE'] } },
      _sum: { amount: true },
    });
    const paidAmount = collected._sum.amount ?? 0n;
    if (paidAmount < booking.depositAmount) throw depositNotCollected();
    await confirmBooking(tx, this.audit, {
      bookingId,
      propertyId: booking.propertyId,
      fromStatus,
      paymentId: payment.id,
      paidAmount,
      caller,
      now,
    });
    const row = await tx.bookings.findUniqueOrThrow({
      where: { id: bookingId },
      select: bookingSelect,
    });
    return project(row);
  }

  async list(caller: BookingCaller, query: BookingsQuery): Promise<ListPage<BookingSummary>> {
    requireRead(this.permissions, caller);
    return listBookings(this.db, caller, query);
  }

  async get(caller: BookingCaller, bookingId: string): Promise<BookingSummary> {
    const row = await this.db.bookings.findUnique({
      where: { id: bookingId },
      select: bookingSelect,
    });
    if (row === null) throw missing();
    requireBookingRead(this.permissions, caller, {
      guestId: row.guest_id,
      propertyId: row.property_id,
    });
    return project(row);
  }
}
