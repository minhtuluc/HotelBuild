/**
 * Use case giữ chỗ có thời hạn (UC-BOOK-04, HB-076) — `POST /holds` + `DELETE /holds/{holdId}`.
 *
 * Thứ tự thi hành theo ADR-014 và api.md §3.4:
 * 1. khoá tài nguyên theo thứ tự `properties → room_types → rooms` (`lock.ts`); hàng idempotency đã
 *    được `IdempotencyStore` khoá trước đó;
 * 2. tiêu thụ quote (HB-074) — điểm nối **duy nhất**, lệch/hết hạn trả đúng mã của HB-074, giá lấy
 *    nguyên từ quote, không tự tính lại (BR-RATE-17);
 * 3. kiểm tồn bằng engine HB-032 **sau** khi khoá (`availability.ts`), hạn hold lấy **giờ CSDL** cộng
 *    `channels.hold_minutes` (BR-BOOK-07); kênh `holdMinutes = 0` ⇒ `E_BOOK_INVALID_STATE`;
 * 4. ghi `bookings` (HELD) + `booking_rooms` + `room_assignments` + history + audit + outbox trong
 *    **một** transaction (`writes.ts`) — ràng buộc loại trừ `excl_room_assignments_no_double_booking`
 *    từ chối thì `23P01` đổi thành `409 E_INV_ROOM_TAKEN`, cấm nuốt lỗi rồi báo thành công (BR-INV-03).
 *
 * Giải phóng: khoá `bookings → properties → room_types → rooms`, nhả assignment ngay, booking →
 * `CANCELLED` (BR-BOOK-11/14), audit cùng transaction. Hold phải còn **hiệu lực** theo giờ CSDL
 * (BR-BOOK-18): hết hạn thì `E_BOOK_INVALID_STATE` vì phòng đã trở về tồn khả dụng.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma as PrismaTypes, PrismaClient } from '@prisma/client';
import { holdSchema } from '@pinehill/contracts';
import type { Hold } from '@pinehill/contracts';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { RateQuoteService } from '../../rate/quotes/service.js';
import { planHold } from './availability.js';
import { inventoryError, lockHeldHold, lockStock } from './lock.js';
import { requireGuest, requireHoldAccess } from './principal.js';
import type { HoldCaller } from './principal.js';
import { HoldProjection } from './projection.js';
import { invalidState, missing, overCapacity } from './validation.js';
import type { HoldInput } from './validation.js';
import { assertReleasable, insertHold, releaseHold } from './writes.js';

type Tx = PrismaTypes.TransactionClient;

@Injectable()
export class HoldsService {
  constructor(
    @Inject(PRISMA) readonly db: PrismaClient,
    @Inject(RateQuoteService) readonly quotes: RateQuoteService,
    @Inject(PermissionRegistry) readonly permissions: PermissionRegistry,
    @Inject(AuditWriter) readonly audit: AuditWriter,
    @Inject(HoldProjection) readonly projection: HoldProjection,
  ) {}

  async create(tx: Tx, caller: HoldCaller, input: HoldInput): Promise<Hold> {
    requireGuest(caller);
    try {
      const consumed = await this.quotes.consume(input.quoteId, caller.principal, input);
      const channel = await tx.channels.findUnique({
        where: { code: input.channelCode },
        select: { id: true, hold_minutes: true },
      });
      if (channel === null) throw missing();
      // api.md §3.4 + BR-BOOK-07: kênh `holdMinutes = 0` (WALKIN, các OTA) không dùng HELD.
      if (channel.hold_minutes === 0)
        throw invalidState('Kênh này không dùng giữ chỗ tạm (holdMinutes = 0).');
      const stock = await lockStock(tx, input.propertyId, input.roomTypeId);
      if (stock.capacityAdults * input.roomCount < input.adults + input.children)
        throw overCapacity();
      const plan = await planHold(tx, input);
      const ratePlan = await tx.rate_plans.findUnique({
        where: { code: consumed.input.ratePlanCode },
        select: { id: true },
      });
      if (ratePlan === null) throw missing();
      const written = await insertHold(tx, this.audit, {
        input,
        caller,
        quote: consumed.quote,
        ratePlanId: ratePlan.id,
        channelId: channel.id,
        units: plan.units,
        facts: plan.facts,
        holdMinutes: channel.hold_minutes,
        ip: caller.ip,
        correlationId: caller.correlationId,
      });
      // Redis chỉ là bộ đếm nhanh (csdl.md §3); lỗi ở đây không làm hỏng lệnh giữ chỗ.
      await this.projection.save(
        {
          id: written.id,
          bookingId: written.id,
          channelId: channel.id,
          expiresAt: written.holdExpiresAt.toISOString(),
          status: 'ACTIVE',
          releasedAt: null,
          createdAt: written.createdAt.toISOString(),
          quotedTotal: consumed.quote.total,
        },
        channel.hold_minutes * 60,
      );
      return holdSchema.parse({
        holdId: written.id,
        bookingId: written.id,
        bookingCode: written.code,
        bookingStatus: 'HELD',
        status: 'ACTIVE',
        channelId: channel.id,
        releasedAt: null,
        expiresAt: written.holdExpiresAt.toISOString(),
        holdExpiresAt: written.holdExpiresAt.toISOString(),
        quotedTotal: consumed.quote.total,
        createdAt: written.createdAt.toISOString(),
      });
    } catch (error) {
      inventoryError(error);
    }
  }

  async release(tx: Tx, caller: HoldCaller, holdId: string, reason: string): Promise<void> {
    try {
      await lockHeldHold(tx, holdId);
      const booking = await tx.bookings.findUnique({
        where: { id: holdId },
        select: {
          status: true,
          guest_id: true,
          property_id: true,
          room_type_id: true,
          check_in: true,
          check_out: true,
          hold_expires_at: true,
        },
      });
      if (booking === null) throw missing();
      requireHoldAccess(this.permissions, caller, {
        guestId: booking.guest_id,
        propertyId: booking.property_id,
      });
      const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
      assertReleasable(booking.status, booking.hold_expires_at, now);
      await releaseHold(tx, this.audit, {
        bookingId: holdId,
        propertyId: booking.property_id,
        roomTypeId: booking.room_type_id,
        checkIn: booking.check_in.toISOString().slice(0, 10),
        checkOut: booking.check_out.toISOString().slice(0, 10),
        reason,
        caller,
        now,
        ip: caller.ip,
        correlationId: caller.correlationId,
      });
      await this.projection.markReleased(holdId, now);
    } catch (error) {
      inventoryError(error);
    }
  }
}
