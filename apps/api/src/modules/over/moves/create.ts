/**
 * Bước dựng lệnh điều chuyển ở trạng thái PROPOSED (HB-125 AC4/AC5): kiểm loại lệnh, khoá phòng
 * đích, chấm điểm giữ khách và ghi lệnh + audit trong transaction của caller.
 *
 * Đề xuất **không** giữ/kiểm tồn phòng đích: `execute` mới đọc lại availability; đổi lại lệnh
 * PROPOSED không chiếm phòng nên khách khác vẫn có thể giữ trước khi thực thi.
 */
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { businessConflict, invalid, requireProperties } from '../support.js';
import type { Tx } from '../support.js';
import type { MoveRow } from '../views.js';
import { checkGeometry } from './geometry.js';
import { roomTypeOf } from './queries.js';
import type { NormalizedMove } from './validation.js';
import { lockTargetRoom, type BookingRow, type RoomTarget } from './writes.js';

/** Chỉ điều chuyển booking đã xác nhận hoặc đang lưu trú. */
export function assertBookingMovable(status: string): void {
  if (['CONFIRMED', 'CHECKED_IN'].includes(status)) return;
  throw businessConflict(
    'E_OVER_MOVE_NOT_ALLOWED',
    'Chỉ điều chuyển booking đã xác nhận hoặc đang lưu trú.',
  );
}

/** Chặn loại lệnh của use case khác và điều chuyển khi khách đã nhận phòng mà không bất khả kháng. */
export function assertMoveTypeAllowed(command: NormalizedMove, bookingStatus: string): void {
  const walkOut = command.moveType === 'WALK_OUT';
  if (!walkOut && command.moveType.startsWith('MERGE_'))
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Ghép phòng dùng /room-merges.');
  if (bookingStatus === 'CHECKED_IN' && !walkOut && command.forceMajeure !== true)
    throw businessConflict(
      'E_OVER_MOVE_NOT_ALLOWED',
      'Khách đã nhận phòng chỉ điều chuyển khi bất khả kháng và có MANAGER duyệt.',
    );
}

/** Khoá phòng đích rồi kiểm hình học; walk-out không có phòng đích nên trả `null`. */
export async function resolveTarget(
  tx: Tx,
  actor: AuthorizedActor,
  command: NormalizedMove,
  booking: BookingRow,
  roomTypeId: string,
): Promise<RoomTarget | null> {
  if (command.moveType === 'WALK_OUT') return null;
  if (command.toRoomId === undefined) throw invalid('Điều chuyển thường bắt buộc có phòng đích.');
  const target = await lockTargetRoom(tx, command.toRoomId);
  requireProperties(actor, [target.property_id]);
  if (target.status !== 'ACTIVE')
    throw businessConflict('E_INV_ROOM_TAKEN', 'Phòng đích không còn hoạt động.');
  if (command.toPropertyId !== undefined && command.toPropertyId !== target.property_id)
    throw invalid('`toPropertyId` không khớp phòng đích.');
  const bookingType = await roomTypeOf(tx, roomTypeId);
  checkGeometry(command.moveType, bookingType, target, booking.property_id, booking.adults);
  return target;
}

export interface ProposedMoveInput {
  readonly command: NormalizedMove;
  readonly booking: BookingRow;
  readonly fromRoomId: string | null;
  readonly target: RoomTarget | null;
  readonly keepScore: number;
}

/** INSERT lệnh PROPOSED; các cột nullable lấy từ lệnh (walk-out không có phòng đích). */
async function insertMoveRow(tx: Tx, input: ProposedMoveInput): Promise<MoveRow> {
  const { command, booking, fromRoomId, target, keepScore } = input;
  const targetId = target === null ? null : target.id;
  const targetPropertyId = target === null ? null : target.property_id;
  const created = await tx.$queryRaw<MoveRow[]>`
      INSERT INTO room_moves(booking_id, booking_room_id, move_type, from_room_id, to_room_id,
        from_property_id, to_property_id, reason, keep_score, price_locked, compensation_amount,
        transport_cost, walk_out_doc_no, guest_signature_ref, staff_signature_ref, status)
      VALUES(${booking.id}::uuid, ${command.bookingRoomId}::uuid, ${command.moveType},
        ${fromRoomId}::uuid, ${targetId}::uuid, ${booking.property_id}::uuid,
        ${targetPropertyId}::uuid, ${maskOperationalText(command.reason)}, ${keepScore},
        true, ${BigInt(command.compensationAmount)}, ${BigInt(command.transportCost)},
        ${command.walkOut?.walkOutDocNo ?? null}, ${command.walkOut?.guestSignatureRef ?? null},
        ${command.walkOut?.staffSignatureRef ?? null}, 'PROPOSED')
      RETURNING *`;
  return created[0]!;
}

/** INSERT lệnh PROPOSED kèm audit `ROOM_MOVE_PROPOSED`; trả dòng vừa tạo. */
export async function insertProposedMove(
  tx: Tx,
  actor: AuthorizedActor,
  audit: AuditWriter,
  input: ProposedMoveInput,
): Promise<MoveRow> {
  const row = await insertMoveRow(tx, input);
  const targetId = input.target === null ? null : input.target.id;
  await audit.record(tx, {
    actor,
    action: 'ROOM_MOVE_PROPOSED',
    entityType: 'RoomMove',
    entityId: row.id,
    beforeJson: null,
    afterJson: {
      bookingId: input.booking.id,
      bookingRoomId: input.command.bookingRoomId,
      moveType: input.command.moveType,
      fromRoomId: input.fromRoomId,
      toRoomId: targetId,
      compensationAmount: input.command.compensationAmount,
      transportCost: input.command.transportCost,
    },
    reason: maskOperationalText(input.command.reason),
  });
  return row;
}
