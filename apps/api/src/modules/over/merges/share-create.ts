/**
 * Tạo lệnh `MERGE_SHARE`: hai booking độc lập cùng hạng phòng đang cho ghép, kỳ lưu trú giao nhau,
 * phòng đích còn đủ điều kiện. Chiết khấu 20%/bên chỉ ghi nhận, nghĩa vụ thu giữ nguyên đến khi thực thi.
 */
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { lockTargetRoom, type BookingRow, type RoomTarget } from '../moves/writes.js';
import { businessConflict, businessDate, invalid, requireProperties, type Tx } from '../support.js';
import type { ShareMergeCommand } from './validation.js';
import { chargeSum, insertMerge, lockBookingPair, roomType, type TypeRow } from './queries.js';
import { mergeBodyOf } from './view.js';

/** Khoá cặp booking theo thứ tự id rồi kiểm tra property, trạng thái, hạng phòng và sức chứa. */
async function lockShareParties(
  tx: Tx,
  actor: AuthorizedActor,
  command: ShareMergeCommand,
): Promise<{ left: BookingRow; right: BookingRow; type: TypeRow }> {
  const { primary: left, secondary: right } = await lockBookingPair(
    tx,
    command.primaryBookingId,
    command.secondaryBookingId,
  );
  requireProperties(actor, [left.property_id, right.property_id]);
  for (const booking of [left, right])
    if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status))
      throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Chỉ ghép booking đã xác nhận.');
  if (left.room_type_id !== right.room_type_id)
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Ghép phòng cần cùng hạng phòng.');
  const type = await roomType(tx, left.room_type_id);
  if (!type.allow_shared)
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Hạng phòng không cho phép ghép.');
  if (left.adults + right.adults > type.capacity_adults)
    throw businessConflict('E_BOOK_OVER_CAPACITY', 'Tổng khách vượt sức chứa phòng ghép.');
  return { left, right, type };
}

function assertOverlap(left: BookingRow, right: BookingRow): void {
  const leftIn = businessDate(left.check_in);
  const leftOut = businessDate(left.check_out);
  const rightIn = businessDate(right.check_in);
  const rightOut = businessDate(right.check_out);
  if (!(leftIn < rightOut && rightIn < leftOut))
    throw businessConflict(
      'E_OVER_MOVE_NOT_ALLOWED',
      'Kỳ lưu trú của hai booking không giao nhau.',
    );
}

/** Phòng đích phải cùng property/hạng phòng với bên trái, đang hoạt động và có từ hai giường. */
async function lockShareTarget(
  tx: Tx,
  actor: AuthorizedActor,
  roomId: string,
  left: BookingRow,
): Promise<RoomTarget> {
  const target = await lockTargetRoom(tx, roomId);
  requireProperties(actor, [target.property_id]);
  if (
    target.room_type_id !== left.room_type_id ||
    target.property_id !== left.property_id ||
    target.status !== 'ACTIVE'
  )
    throw businessConflict('E_INV_ROOM_TAKEN', 'Phòng ghép không còn phù hợp.');
  if (target.bed_count <= 1)
    throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Phòng ghép chỉ có một giường.');
  return target;
}

/** 20% doanh thu phòng của mỗi bên, làm tròn xuống từng bên rồi cộng lại. */
async function shareDiscount(tx: Tx, left: BookingRow, right: BookingRow): Promise<bigint> {
  const leftRevenue = await chargeSum(tx, left.id);
  const rightRevenue = await chargeSum(tx, right.id);
  if (leftRevenue <= 0n || rightRevenue <= 0n)
    throw invalid('Booking chưa có nghĩa vụ phòng để ghép.');
  const leftDiscount = (leftRevenue * 20n) / 100n;
  const rightDiscount = (rightRevenue * 20n) / 100n;
  return leftDiscount + rightDiscount;
}

export async function createShare(
  tx: Tx,
  actor: AuthorizedActor,
  command: ShareMergeCommand,
  audit: AuditWriter,
) {
  const { left, right } = await lockShareParties(tx, actor, command);
  assertOverlap(left, right);
  const target = await lockShareTarget(tx, actor, command.roomId, left);
  const discountAmount = await shareDiscount(tx, left, right);
  const row = await insertMerge(tx, {
    primaryBookingId: left.id,
    secondaryBookingId: right.id,
    roomId: target.id,
    secondaryRoomId: null,
    moveType: 'MERGE_SHARE',
    discountPct: 20,
    discountAmount,
    status: 'PENDING_CONSENT',
  });
  await audit.record(tx, {
    actor,
    action: 'ROOM_MERGE_PROPOSED',
    entityType: 'RoomMerge',
    entityId: row.id,
    beforeJson: null,
    afterJson: {
      moveType: 'MERGE_SHARE',
      primaryBookingId: left.id,
      secondaryBookingId: right.id,
      roomId: target.id,
      discountAmount: discountAmount.toString(),
    },
    reason: null,
  });
  return { id: row.id, body: await mergeBodyOf(tx, row) };
}
