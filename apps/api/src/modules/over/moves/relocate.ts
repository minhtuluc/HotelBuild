/**
 * Thực thi điều chuyển thường (HB-125 AC4–AC10): khoá phòng theo thứ tự UUID, đọc lại tồn phòng
 * đích, thay assignment, ghi trạng thái + outbox + audit trong transaction của caller.
 */
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { businessConflict, businessDate, invalid, roomTaken } from '../support.js';
import type { Tx } from '../support.js';
import type { MoveRow } from '../views.js';
import { checkGeometry } from './geometry.js';
import { roomTypeOf } from './queries.js';
import {
  freeBed,
  insertAssignment,
  lockRooms,
  lockTargetRoom,
  releaseAssignmentsOf,
  setMoveStatus,
  writeOverOutbox,
  type BookingRow,
} from './writes.js';

/** Di chuyển một đơn vị booking sang phòng đích, giữ nguyên giá/đơn vị giá. */
export async function executeRelocation(
  tx: Tx,
  actor: AuthorizedActor,
  row: MoveRow,
  booking: BookingRow,
  now: Date,
  audit: AuditWriter,
): Promise<void> {
  if (row.to_room_id === null) throw invalid('Lệnh thiếu phòng đích.');
  await lockRooms(
    tx,
    row.from_room_id === null ? [row.to_room_id] : [row.from_room_id, row.to_room_id],
  );
  const target = await lockTargetRoom(tx, row.to_room_id);
  if (target.status !== 'ACTIVE')
    throw businessConflict('E_INV_ROOM_TAKEN', 'Phòng đích không còn hoạt động.');
  const bookingType = await roomTypeOf(tx, booking.room_type_id);
  checkGeometry(row.move_type, bookingType, target, booking.property_id, booking.adults);
  const checkIn = businessDate(booking.check_in);
  const checkOut = businessDate(booking.check_out);
  if (await roomTaken(tx, target.id, checkIn, checkOut, row.booking_room_id))
    throw businessConflict('E_INV_ROOM_TAKEN', 'Phòng đích vừa bị khách khác giữ.');
  const bedNo = target.allow_shared
    ? await freeBed(tx, target.id, checkIn, checkOut, target.bed_count)
    : 0;
  await releaseAssignmentsOf(tx, row.booking_room_id, 'OVERBOOKING_RELOCATION', now);
  await insertAssignment(tx, {
    bookingRoomId: row.booking_room_id,
    roomId: target.id,
    bedNo,
    checkIn,
    checkOut,
  });
  await setMoveStatus(tx, row.id, 'EXECUTED', now);
  await writeOverOutbox(tx, {
    eventType: 'InventoryChanged',
    aggregateType: 'Booking',
    aggregateId: booking.id,
    payload: {
      propertyId: booking.property_id,
      roomTypeId: booking.room_type_id,
      roomId: target.id,
      bookingId: booking.id,
      operation: 'OVERBOOKING_RELOCATION',
    },
  });
  await audit.record(tx, {
    actor,
    action: 'ROOM_MOVE_EXECUTED',
    entityType: 'RoomMove',
    entityId: row.id,
    beforeJson: { status: row.status, toRoomId: target.id, bookingRoomId: row.booking_room_id },
    afterJson: {
      status: 'EXECUTED',
      bookingId: booking.id,
      fromRoomId: row.from_room_id,
      toRoomId: target.id,
      bedNo,
    },
    reason: null,
  });
}
