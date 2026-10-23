/**
 * Ghép phòng thực tế ↔ đơn vị bán của booking (HB-206, F7-QA-04). Hàm thuần.
 *
 * Người gọi chọn **tập** phòng, không biết `booking_rooms.id` nên thứ tự `actualRoomIds` không mang nghĩa.
 * 1. Đơn vị đã có assignment đang hiệu lực vào một phòng thuộc tập chọn thì **giữ** phòng đó (đảo thứ tự
 *    không còn buộc giải phóng một phòng đang do đơn vị kia giữ ⇒ không vi phạm ràng buộc loại trừ).
 * 2. Phòng còn lại (sắp theo id tăng dần) ghép vào đơn vị còn lại (sắp theo id tăng dần) — ổn định với
 *    mọi hoán vị của cùng tập phòng.
 */
export interface UnitRoom {
  readonly bookingRoomId: string;
  readonly roomId: string;
}

export function matchRoomsToUnits(
  unitIds: readonly string[],
  current: ReadonlyMap<string, string>,
  actualRoomIds: readonly string[],
): readonly UnitRoom[] {
  const chosen = new Set(actualRoomIds);
  const kept = new Map<string, string>();
  const taken = new Set<string>();
  for (const unit of unitIds) {
    const room = current.get(unit);
    if (room !== undefined && chosen.has(room) && !taken.has(room)) {
      kept.set(unit, room);
      taken.add(room);
    }
  }
  const spare = [...chosen].filter((room) => !taken.has(room)).sort();
  let next = 0;
  return unitIds.map((unit) => ({
    bookingRoomId: unit,
    roomId: kept.get(unit) ?? spare[next++]!,
  }));
}
