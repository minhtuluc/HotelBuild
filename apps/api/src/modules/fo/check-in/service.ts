/**
 * `POST /front-office/check-in` (HB-144, UC-FO-01; api.md §2.9; BR-FO-01/02/04/07).
 *
 * Một transaction idempotency (HB-029) gồm:
 * 1. khoá booking → `booking_rooms` → `rooms` theo ADR-014, đọc số dư từ **sổ cái** HB-093 (không dùng
 *    `bookings.balance_due` làm nguồn quyết định) và dữ kiện sẵn sàng của lượt giải phóng hiện tại;
 * 2. giao quyết định cho engine HB-141 (`@pinehill/domain/front-office`) — không chép lại luật nợ,
 *    mốc 23:59, giá đêm đầu hay trạng thái phòng;
 * 3. gán `actualRoomIds` bằng ràng buộc loại trừ CSDL (F4), đổi trạng thái + lịch sử + audit cùng
 *    transaction; lỗi bất kỳ rollback toàn bộ, kể cả claim idempotency.
 *
 * Mốc nghiệp vụ (ngày VN, 23:59, 12:00/14:00) đọc qua `CLOCK` tiêm như mọi harness F1/F7; mốc **ghi**
 * `checkedInAt` lấy `clock_timestamp()` sau khoá (ADR-014). Không ghi log, không trả/thu thêm tiền:
 * phụ thu check-in sớm do engine tính và chưa hạch toán thành nghĩa vụ ở lát cắt này.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { checkIn as decideCheckIn } from '@pinehill/domain/front-office';
import type { CheckInFailure, CheckInInput } from '@pinehill/domain/front-office';
import { checkInResponseSchema } from '@pinehill/contracts';
import type { CheckInResponse } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { BookingLedger } from '../../pay/ledger/service.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { refused } from './errors.js';
import { lockCheckInFacts, money } from './facts.js';
import type { CheckInFacts } from './facts.js';
import { command, localNow } from './validation.js';
import type { Command } from './validation.js';
import { writeCheckIn } from './writes.js';

type Tx = Prisma.TransactionClient;

/** Vai trò được tự duyệt nợ (BR-FO-01); OWNER không bị chặn ngưỡng. */
const approverRole = (role: string): 'MANAGER' | 'OWNER' | null =>
  role === 'OWNER' ? 'OWNER' : role === 'MANAGER' ? 'MANAGER' : null;

@Injectable()
export class CheckInService {
  private readonly ledger: BookingLedger;
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {
    this.ledger = new BookingLedger(clock);
  }

  async checkIn(tx: Tx, actor: AuthorizedActor, body: unknown): Promise<CheckInResponse> {
    const input = command(body);
    const facts = await lockCheckInFacts(tx, actor, input, this.ledger);
    // Ghi chú là văn bản tự do của người gọi: che số điện thoại/email trước khi vào nhật ký (BR-GEN-07).
    const note = input.note === undefined ? undefined : maskOperationalText(input.note);
    const balanceDue = money(facts.balanceDue);
    const role = approverRole(actor.role);
    const base: CheckInInput = {
      bookingId: facts.booking.id,
      status: facts.booking.status,
      checkInDate: facts.checkInDate,
      localNow: localNow(this.clock.now()),
      totalAmount: money(facts.booking.totalAmount),
      balanceDue,
      firstNightAmount: money(facts.firstNight),
      units: facts.units,
      debtApproval:
        balanceDue > 0 && role !== null
          ? { bookingId: facts.booking.id, amount: balanceDue, approverRole: role }
          : null,
      managerDebtLimits: facts.limits,
    };
    const earlyCheckInFee = await this.decide(tx, actor, facts, input, note, base);

    const checkedInAt = await writeCheckIn(tx, this.audit, actor, {
      booking: facts.booking,
      assignments: facts.bookingRooms.map((room, index) => ({
        bookingRoomId: room.id,
        roomId: input.actualRoomIds[index]!,
      })),
      roomIds: input.actualRoomIds,
      note,
      idNumber: input.idNumber,
      earlyCheckInFee,
      balanceDue,
      debt:
        balanceDue > 0 && role !== null
          ? { amount: balanceDue, collectionDeadline: facts.checkOutDate }
          : null,
    });
    return checkInResponseSchema.parse({
      bookingId: facts.booking.id,
      status: 'CHECKED_IN',
      roomIds: input.actualRoomIds,
      checkedInAt: checkedInAt.toISOString(),
      earlyCheckInFee,
    });
  }

  /**
   * Giao quyết định cho engine HB-141 rồi kiểm lại một lần với số dư đã gồm phụ thu check-in sớm
   * (BR-FO-01,04) — không chép công thức 30% giá đêm đầu. Bị từ chối thì ghi vết rồi ném 409.
   */
  private async decide(
    tx: Tx,
    actor: AuthorizedActor,
    facts: CheckInFacts,
    input: Command,
    note: string | undefined,
    base: CheckInInput,
  ): Promise<number> {
    const decision = decideCheckIn(base);
    if (!decision.ok) {
      await this.refuse(tx, actor, facts, input, note, decision.error);
      throw refused(decision.error);
    }
    if (decision.value.earlyCheckInFee === 0 || base.balanceDue === 0)
      return decision.value.earlyCheckInFee;
    const withFee = decideCheckIn({
      ...base,
      balanceDue: base.balanceDue + decision.value.earlyCheckInFee,
    });
    if (!withFee.ok) {
      await this.refuse(tx, actor, facts, input, note, withFee.error);
      throw refused(withFee.error);
    }
    return decision.value.earlyCheckInFee;
  }

  /**
   * BR-SYS-05: lượt nhận phòng bị từ chối vẫn là hành động nghiệp vụ cần vết (ai, booking nào, lý
   * do). Ghi trong **cùng** transaction nên lỗi hạ tầng nhật ký chặn cả lệnh (fail closed) thay vì
   * trả 409 trong khi nhật ký hỏng — đúng bất biến ca "audit không ghi được" của HB-143 khoá. Lệnh bị
   * từ chối vẫn rollback, nên dòng này chỉ có tác dụng bắt lỗi hạ tầng audit (không lưu lại).
   */
  private async refuse(
    tx: Tx,
    actor: AuthorizedActor,
    facts: CheckInFacts,
    input: Command,
    note: string | undefined,
    failure: CheckInFailure,
  ): Promise<void> {
    await this.audit.record(tx, {
      actor,
      action: 'CHECKIN_REFUSED',
      entityType: 'Booking',
      entityId: facts.booking.id,
      beforeJson: {
        propertyId: facts.booking.propertyId,
        status: facts.booking.status,
        balanceDue: facts.balanceDue.toString(),
      },
      afterJson: {
        propertyId: facts.booking.propertyId,
        roomIds: [...input.actualRoomIds],
        reason: failure.code === 'E_FO_CHECKIN_NOT_ALLOWED' ? failure.reason : failure.code,
      },
      reason: note ?? null,
    });
  }
}
