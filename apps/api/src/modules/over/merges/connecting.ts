/**
 * `MERGE_CONNECTING`: một booking giữ hai phòng thông nhau, không cần consent nên lệnh vào thẳng
 * APPROVED; tạo chỉ kiểm tra điều kiện, thực thi mới ghi chiết khấu 10% và phát outbox/audit.
 */
import { evaluateRoomMerge } from '@pinehill/domain/overbooking';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import {
  applyDiscount,
  assignedUnits,
  chargeSumOfRoom,
  connectedRoom,
  insertMerge,
  type ConnectedRoom,
} from './queries.js';
import { lockBooking, lockRooms, writeOverOutbox } from '../moves/writes.js';
import { businessConflict, requireProperties, type Tx } from '../support.js';
import type { MergeRow } from '../views.js';
import type { ConnectingMergeCommand } from './validation.js';
import { mergeBodyOf } from './view.js';

const CONNECTING_FAILED = 'Hai phòng không đủ điều kiện thông nhau.';

function connectingDecision(
  roomA: ConnectedRoom,
  roomB: ConnectedRoom,
  totalGuests: number,
  revenueA: bigint,
  revenueB: bigint,
) {
  return evaluateRoomMerge({
    kind: 'MERGE_CONNECTING',
    roomA: {
      roomId: roomA.id,
      connectingRoomId: roomA.connecting_room_id,
      capacity: roomA.capacity_adults,
      priceVnd: Number(revenueA),
    },
    roomB: {
      roomId: roomB.id,
      connectingRoomId: roomB.connecting_room_id,
      capacity: roomB.capacity_adults,
      priceVnd: Number(revenueB),
    },
    totalGuests,
  });
}

/** Kiểm tra hai phòng thông nhau, hai đơn vị phòng và quyết định chiết khấu của domain. */
async function assertConnectingEligible(
  tx: Tx,
  bookingId: string,
  roomA: ConnectedRoom,
  roomB: ConnectedRoom,
) {
  const units = await assignedUnits(tx, bookingId, [roomA.id, roomB.id]);
  const unitA = units.get(roomA.id);
  const unitB = units.get(roomB.id);
  if (unitA === undefined || unitB === undefined)
    throw businessConflict(
      'E_OVER_MOVE_NOT_ALLOWED',
      'Booking chưa giữ đủ hai phòng thông nhau để ghép.',
    );
  return {
    revenueA: await chargeSumOfRoom(tx, unitA),
    revenueB: await chargeSumOfRoom(tx, unitB),
  };
}

export async function createConnecting(
  tx: Tx,
  actor: AuthorizedActor,
  command: ConnectingMergeCommand,
  audit: AuditWriter,
) {
  const booking = await lockBooking(tx, command.bookingId);
  requireProperties(actor, [booking.property_id]);
  if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status))
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Chỉ ghép booking đã xác nhận.');
  const roomA = await connectedRoom(tx, command.roomIdA);
  const roomB = await connectedRoom(tx, command.roomIdB);
  requireProperties(actor, [roomA.property_id, roomB.property_id]);
  const { revenueA, revenueB } = await assertConnectingEligible(tx, booking.id, roomA, roomB);
  const decision = connectingDecision(
    roomA,
    roomB,
    booking.adults + booking.children,
    revenueA,
    revenueB,
  );
  if (!decision.ok) throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', CONNECTING_FAILED);
  const row = await insertMerge(tx, {
    primaryBookingId: booking.id,
    secondaryBookingId: null,
    roomId: roomA.id,
    secondaryRoomId: roomB.id,
    moveType: 'MERGE_CONNECTING',
    discountPct: 10,
    discountAmount: BigInt(decision.value.discountAmount.amount),
    status: 'APPROVED',
  });
  await audit.record(tx, {
    actor,
    action: 'ROOM_MERGE_PROPOSED',
    entityType: 'RoomMerge',
    entityId: row.id,
    beforeJson: null,
    afterJson: {
      moveType: 'MERGE_CONNECTING',
      bookingId: booking.id,
      roomIdA: roomA.id,
      roomIdB: roomB.id,
      discountAmount: decision.value.discountAmount.amount,
    },
    reason: null,
  });
  return { id: row.id, body: await mergeBodyOf(tx, row) };
}

export async function executeConnecting(
  tx: Tx,
  actor: AuthorizedActor,
  row: MergeRow,
  now: Date,
  audit: AuditWriter,
): Promise<void> {
  const booking = await lockBooking(tx, row.primary_booking_id);
  if (row.secondary_room_id === null)
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Merge thông nhau thiếu phòng thứ hai.');
  const roomA = await connectedRoom(tx, row.room_id);
  const roomB = await connectedRoom(tx, row.secondary_room_id);
  await lockRooms(tx, [roomA.id, roomB.id]);
  const units = await assignedUnits(tx, booking.id, [roomA.id, roomB.id]);
  if (!units.has(roomA.id) || !units.has(roomB.id))
    throw businessConflict(
      'E_OVER_MOVE_NOT_ALLOWED',
      'Booking không còn giữ đủ hai phòng thông nhau.',
    );
  const revenueA = await chargeSumOfRoom(tx, units.get(roomA.id)!);
  const revenueB = await chargeSumOfRoom(tx, units.get(roomB.id)!);
  const decision = connectingDecision(
    roomA,
    roomB,
    booking.adults + booking.children,
    revenueA,
    revenueB,
  );
  if (!decision.ok) throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', decision.error.message);
  if (decision.value.kind !== 'MERGE_CONNECTING')
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Quyết định ghép không khớp mô hình.');
  const value = decision.value;
  await applyDiscount(tx, booking.id, value.netCombinedReference.amount, now);
  await tx.$executeRaw`
    UPDATE room_merges SET status='ACTIVE', updated_at=${now}::timestamptz
     WHERE id=${row.id}::uuid`;
  await writeOverOutbox(tx, {
    eventType: 'RoomMergeActivated',
    aggregateType: 'RoomMerge',
    aggregateId: row.id,
    payload: {
      moveType: 'MERGE_CONNECTING',
      bookingId: booking.id,
      roomIdA: roomA.id,
      roomIdB: roomB.id,
      discountAmount: value.discountAmount.amount,
    },
  });
  await audit.record(tx, {
    actor,
    action: 'ROOM_MERGE_ACTIVATED',
    entityType: 'RoomMerge',
    entityId: row.id,
    beforeJson: { status: row.status },
    afterJson: {
      status: 'ACTIVE',
      bookingId: booking.id,
      roomIdA: roomA.id,
      roomIdB: roomB.id,
      discountAmount: value.discountAmount.amount,
    },
    reason: null,
  });
}
