import type { RoomSummary } from '@pinehill/contracts';

/**
 * Phòng thông nhau là liên kết **hai chiều** (BR-OVER-15). Các hàm ở đây chỉ **đọc** dữ liệu máy chủ
 * trả về để hiển thị và cảnh báo — giao diện không tự suy đoán phòng đối ứng khi ghi.
 */

/** Mã phòng đang thông với `roomId`, `null` nếu chưa thông hoặc không thấy phòng đối ứng. */
export function connectingCode(rooms: readonly RoomSummary[], roomId: string): string | null {
  const room = rooms.find((item) => item.id === roomId);
  if (room === undefined || room.connectingRoomId === null) return null;
  return rooms.find((item) => item.id === room.connectingRoomId)?.code ?? null;
}

/** Phòng có thể chọn làm phòng thông nhau: khác chính nó và cùng cơ sở (BR-PROP-05, BR-OVER-15). */
export function pairingCandidates(
  rooms: readonly RoomSummary[],
  roomId: string,
): readonly RoomSummary[] {
  const room = rooms.find((item) => item.id === roomId);
  if (room === undefined) return [];
  return rooms.filter((item) => item.id !== roomId && item.propertyId === room.propertyId);
}

/** `true` khi liên kết đã đúng hai chiều; `false` khi dữ liệu cho thấy liên kết một chiều. */
export function isSymmetrical(rooms: readonly RoomSummary[], roomId: string): boolean {
  const room = rooms.find((item) => item.id === roomId);
  if (room === undefined || room.connectingRoomId === null) return true;
  const counterpart = rooms.find((item) => item.id === room.connectingRoomId);
  return counterpart !== undefined && counterpart.connectingRoomId === room.id;
}

/** Buồng xếp theo tầng rồi theo mã để sơ đồ đọc được như sơ đồ tầng. */
export function sortByFloorThenCode(rooms: readonly RoomSummary[]): readonly RoomSummary[] {
  return [...rooms].sort((left, right) =>
    left.floor === right.floor ? left.code.localeCompare(right.code) : left.floor - right.floor,
  );
}
