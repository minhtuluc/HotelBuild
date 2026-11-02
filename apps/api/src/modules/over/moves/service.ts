/**
 * Use case điều chuyển/walk-out (HB-125 AC4–AC10). Mọi lệnh chạy **một** transaction của
 * `IdempotencyStore`: khoá aggregate → đọc lại version/assignment/tồn → quyết định bằng domain →
 * ghi assignment + trạng thái + audit + outbox cùng commit. Lỗi bất kỳ rollback toàn bộ, nguồn
 * không bị mất khi đích đã bị chiếm.
 *
 * Tệp này chỉ điều phối: dựng lệnh ở `create.ts`, thực thi ở `relocate.ts`/`walkout.ts`, đọc phụ
 * trợ ở `queries.ts`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { BookingLedger } from '../../pay/ledger/service.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { PIN_PURPOSE_FINANCIAL, requirePinToken } from '../../auth/pin/consume.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { activeAssignmentsOf, lockBooking, lockMove, type BookingRow } from './writes.js';
import {
  businessConflict,
  businessDate,
  moveETag,
  notFound,
  requireIfMatch,
  requireProperties,
  writeIntentOf,
  type Tx,
} from '../support.js';
import { moveApproveInput, moveCreateInput, moveExecuteInput } from './validation.js';
import { moveView, type MoveRow } from '../views.js';
import {
  assertBookingMovable,
  assertMoveTypeAllowed,
  insertProposedMove,
  resolveTarget,
} from './create.js';
import { bookingRoomOf, currentRoomOf, keepScoreOf, overbookingCaseOf } from './queries.js';
import { executeRelocation } from './relocate.js';
import { executeWalkOut } from './walkout.js';

/** F6-D04: duyệt MANAGER chỉ khi có chi phí, đã check-in, khác cơ sở/thành phố. */
function approvalRequired(
  move: MoveRow,
  bookingStatus: string,
  bookingPropertyId: string,
): boolean {
  if (move.compensation_amount + move.transport_cost > 0n) return true;
  if (bookingStatus === 'CHECKED_IN') return true;
  if (move.to_property_id !== null && move.to_property_id !== bookingPropertyId) return true;
  return move.move_type.endsWith('CROSS_PROPERTY');
}

function allowedActions(
  move: MoveRow,
  bookingStatus: string,
  bookingPropertyId: string,
): readonly string[] {
  if (move.status === 'APPROVED') return ['EXECUTE'];
  if (move.status !== 'PROPOSED') return [];
  return approvalRequired(move, bookingStatus, bookingPropertyId) && move.approved_by === null
    ? ['APPROVE', 'EXECUTE']
    : ['EXECUTE'];
}

@Injectable()
export class RoomMoveService {
  private readonly ledger: BookingLedger;
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {
    this.ledger = new BookingLedger(clock);
  }

  async create(tx: Tx, actor: AuthorizedActor, body: unknown) {
    const command = moveCreateInput(body);
    if (command.overbookingCaseId !== undefined) {
      const overbooking = await overbookingCaseOf(tx, command.overbookingCaseId);
      requireProperties(actor, [overbooking.property_id]);
      if (overbooking.status === 'RESOLVED')
        throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Ca quá tải đã đóng.');
    }
    const booking = await lockBooking(tx, command.bookingId);
    requireProperties(actor, [booking.property_id]);
    assertBookingMovable(booking.status);
    const bookingRoom = await bookingRoomOf(tx, command.bookingRoomId, booking.id);
    const fromRoomId = await currentRoomOf(tx, command.bookingRoomId);
    assertMoveTypeAllowed(command, booking.status);
    // Đề xuất **không** giữ/kiểm tồn phòng đích: execute mới đọc lại availability (HB-125 AC1/AC4).
    const target = await resolveTarget(tx, actor, command, booking, bookingRoom.room_type_id);
    const keepScore = await keepScoreOf(
      tx,
      this.clock,
      booking,
      businessDate(booking.check_in),
      businessDate(booking.check_out),
    );
    const row = await insertProposedMove(tx, actor, this.audit, {
      command,
      booking,
      fromRoomId,
      target,
      keepScore,
    });
    return { id: row.id, body: await this.view(tx, row, booking) };
  }

  async approve(tx: Tx, actor: AuthorizedActor, moveId: string, body: unknown) {
    const input = moveApproveInput(body);
    const row = await lockMove(tx, moveId);
    const booking = await lockBooking(tx, row.booking_id);
    requireProperties(actor, [booking.property_id, row.from_property_id, row.to_property_id]);
    if (row.status !== 'PROPOSED')
      throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Chỉ duyệt lệnh đang ở PROPOSED.');
    await requirePinToken(tx, {
      userId: actor.id,
      token: input.pinToken,
      purpose: PIN_PURPOSE_FINANCIAL,
      bookingId: booking.id,
      now: this.clock.now(),
    });
    const now = this.clock.now();
    await tx.$executeRaw`
      UPDATE room_moves SET status='APPROVED', approved_by=${actor.id}::uuid,
             compensation_amount=${BigInt(input.compensationAmount)},
             transport_cost=${BigInt(input.transportCost)}, updated_at=${now}::timestamptz
       WHERE id=${row.id}::uuid`;
    await this.audit.record(tx, {
      actor,
      action: 'ROOM_MOVE_APPROVED',
      entityType: 'RoomMove',
      entityId: row.id,
      beforeJson: {
        status: row.status,
        compensationAmount: row.compensation_amount.toString(),
        transportCost: row.transport_cost.toString(),
      },
      afterJson: {
        bookingId: booking.id,
        status: 'APPROVED',
        compensationAmount: input.compensationAmount,
        transportCost: input.transportCost,
      },
      reason: input.note === undefined ? null : maskOperationalText(input.note),
    });
    const fresh = await lockMove(tx, moveId);
    return { status: 200, body: await this.view(tx, fresh, booking) };
  }

  async execute(tx: Tx, actor: AuthorizedActor, moveId: string, body: unknown, ifMatch: unknown) {
    const input = moveExecuteInput(body);
    const row = await lockMove(tx, moveId);
    const booking = await lockBooking(tx, row.booking_id);
    requireProperties(actor, [booking.property_id, row.from_property_id, row.to_property_id]);
    if (row.status === 'EXECUTED')
      throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Lệnh điều chuyển đã thực thi.');
    if (!['PROPOSED', 'APPROVED'].includes(row.status))
      throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Lệnh không còn hiệu lực.');
    const now = this.clock.now();
    // PIN trước If-Match: token dùng lại phải bị bắt là 401, không lộ trạng thái tem.
    await requirePinToken(tx, {
      userId: actor.id,
      token: input.pinToken,
      purpose: PIN_PURPOSE_FINANCIAL,
      bookingId: booking.id,
      now,
    });
    requireIfMatch(ifMatch, moveETag(row.version, booking.version));
    if (approvalRequired(row, booking.status, booking.property_id) && row.approved_by === null)
      throw businessConflict(
        'E_OVER_APPROVAL_REQUIRED',
        'Lệnh có chi phí/ngoại lệ cần MANAGER duyệt trước khi thực thi.',
      );
    if (row.move_type === 'WALK_OUT')
      await executeWalkOut(tx, actor, row, booking, now, {
        ledger: this.ledger,
        clock: this.clock,
        audit: this.audit,
      });
    else await executeRelocation(tx, actor, row, booking, now, this.audit);
    const fresh = await lockMove(tx, moveId);
    const updated = await lockBooking(tx, row.booking_id);
    return { status: 200, body: await this.view(tx, fresh, updated) };
  }

  async read(actor: AuthorizedActor, moveId: string, query: unknown) {
    const rows = await this.db.$queryRaw<
      (MoveRow & { booking_version: bigint; booking_status: string })[]
    >`SELECT m.*, b.version AS booking_version, b.status AS booking_status
        FROM room_moves m JOIN bookings b ON b.id=m.booking_id
       WHERE m.id=${moveId}::uuid`;
    const row = rows[0];
    if (row === undefined) throw notFound('Không tìm thấy lệnh điều chuyển.');
    requireProperties(actor, [row.from_property_id, row.to_property_id]);
    const key =
      typeof query === 'object' && query !== null && 'idempotencyKey' in query
        ? String(query.idempotencyKey)
        : undefined;
    const writeIntent = await writeIntentOf(this.db, actor, key, 'ROOM_MOVE', row.id, row.id);
    const assignments = await this.db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM room_assignments WHERE booking_room_id=${row.booking_room_id}::uuid
        AND released_at IS NULL`;
    return {
      etag: moveETag(row.version, row.booking_version),
      body: moveView(row, {
        bookingVersion: row.booking_version,
        assignmentIds: assignments.map((item) => item.id),
        allowedActions: allowedActions(row, row.booking_status, row.from_property_id ?? ''),
        writeIntent,
      }),
    };
  }

  private async view(tx: Tx, row: MoveRow, booking: BookingRow) {
    const assignments = await activeAssignmentsOf(tx, row.booking_room_id);
    return moveView(row, {
      bookingVersion: booking.version,
      assignmentIds: assignments.map((item) => item.id),
      allowedActions: allowedActions(row, booking.status, booking.property_id),
      writeIntent: null,
    });
  }
}
