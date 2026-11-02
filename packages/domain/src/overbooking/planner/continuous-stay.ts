/**
 * Whole-stay room selection for the relocation ladder (BR-OVER-05 §6 bậc 1–2).
 *
 * A room only qualifies when it is free on **every** night of the stay. Two rooms that are each
 * free on alternating nights prove nothing: stitching them would hand the guest a different room
 * mid-stay and break the price lock. Selection is deterministic and never mutates its input.
 */

/** Caller-loaded room snapshot; `occupiedDates` are nights already held by other assignments. */
export interface RelocationRoomStock {
  readonly roomId: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly basePriceVnd: number;
  readonly capacityAdults: number;
  readonly occupiedDates: readonly string[];
}

/** Proven whole-stay availability; the planner never returns a stitched pair of partial rooms. */
export interface ContinuousRoomAvailability {
  readonly roomId: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly basePriceVnd: number;
  readonly capacityAdults: number;
}

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/** Normalized Vietnamese civil date; callers pass dates, the engine reads no clock. */
export function isStayDate(value: string): boolean {
  return DATE_PATTERN.test(value);
}

/**
 * True only when the room is free for the whole stay. A free night here and another there is not
 * enough: the ladder must not fabricate continuous availability by mixing rooms.
 */
export function isRoomFreeForWholeStay(
  room: RelocationRoomStock,
  stayDates: readonly string[],
): boolean {
  const occupied = new Set(room.occupiedDates);
  for (const date of stayDates) if (occupied.has(date)) return false;
  return true;
}

function compareRooms(left: ContinuousRoomAvailability, right: ContinuousRoomAvailability): number {
  if (left.propertyId !== right.propertyId) return left.propertyId < right.propertyId ? -1 : 1;
  if (left.roomTypeId !== right.roomTypeId) return left.roomTypeId < right.roomTypeId ? -1 : 1;
  if (left.roomId !== right.roomId) return left.roomId < right.roomId ? -1 : 1;
  return 0;
}

/**
 * Rooms free for the entire stay, sorted by `(propertyId, roomTypeId, roomId)` so the result does
 * not depend on input order. The input array and its rooms are left untouched.
 */
export function continuousStayRooms(
  rooms: readonly RelocationRoomStock[],
  stayDates: readonly string[],
): readonly ContinuousRoomAvailability[] {
  const result: ContinuousRoomAvailability[] = [];
  for (const room of rooms) {
    if (!isRoomFreeForWholeStay(room, stayDates)) continue;
    result.push({
      roomId: room.roomId,
      propertyId: room.propertyId,
      roomTypeId: room.roomTypeId,
      basePriceVnd: room.basePriceVnd,
      capacityAdults: room.capacityAdults,
    });
  }
  return result.sort(compareRooms);
}
