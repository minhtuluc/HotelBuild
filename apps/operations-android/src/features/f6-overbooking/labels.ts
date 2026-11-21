/**
 * HB-270 — nhãn đọc được cho SCR-63. Hợp đồng điều chuyển chỉ trả id phòng/cơ sở. Tên lấy từ hai tuyến đọc
 * có sẵn mà lễ tân/quản lý/chủ đều được gọi: `GET /rooms` (`propertyAdmin.read`, theo phạm vi) và
 * `GET /public/properties`. Lỗi tải tên không chặn màn hình và không bao giờ in UUID ra cho người dùng.
 */
import type { ApiClient } from '@pinehill/api-client';
import {
  listResponseSchema,
  propertyPublicSummarySchema,
  roomSummarySchema,
  type ListPage,
  type MoveType,
  type RoomMoveStatus,
  type RoomSummary,
} from '@pinehill/contracts';

export interface PlaceNames {
  readonly rooms: ReadonlyMap<string, string>;
  readonly properties: ReadonlyMap<string, string>;
}

export const NO_NAMES: PlaceNames = { rooms: new Map(), properties: new Map() };

export interface NameSources {
  rooms(cursor: string | undefined): Promise<ListPage<RoomSummary>>;
  properties(): Promise<readonly { readonly id: string; readonly name: string }[]>;
}

/** Trần số trang phòng (100/trang): chuỗi nhỏ, nhưng không để vòng lặp vô hạn nếu máy chủ trả sai. */
const MAX_ROOM_PAGES = 20;

async function roomCodes(sources: NameSources): Promise<Map<string, string>> {
  const codes = new Map<string, string>();
  let cursor: string | undefined;
  for (let pageNo = 0; pageNo < MAX_ROOM_PAGES; pageNo += 1) {
    const page = await sources.rooms(cursor);
    for (const room of page.data) codes.set(room.id, room.code);
    if (!page.meta.hasMore || page.meta.nextCursor === null) break;
    cursor = page.meta.nextCursor;
  }
  return codes;
}

export async function loadPlaceNames(sources: NameSources): Promise<PlaceNames> {
  const [rooms, properties] = await Promise.all([
    roomCodes(sources).catch(() => new Map<string, string>()),
    sources
      .properties()
      .then((list) => new Map(list.map((property) => [property.id, property.name])))
      .catch(() => new Map<string, string>()),
  ]);
  return { rooms, properties };
}

/** Nguồn tên qua client của phiên; tạo client ở từng lần gọi để dùng token hiện tại (HB-264). */
export function sessionNameSources(client: () => ApiClient): NameSources {
  return {
    rooms: async (cursor) =>
      (
        await client().request({
          method: 'GET',
          path: '/rooms',
          query: { limit: 100, ...(cursor === undefined ? {} : { cursor }) },
          decoder: listResponseSchema(roomSummarySchema),
        })
      ).data,
    properties: async () =>
      (
        await client().request({
          method: 'GET',
          path: '/public/properties',
          decoder: listResponseSchema(propertyPublicSummarySchema),
        })
      ).data.data,
  };
}

export function roomText(id: string | null, names: PlaceNames): string {
  if (id === null) return '—';
  const code = names.rooms.get(id);
  return code === undefined ? 'phòng chưa rõ tên' : `phòng ${code}`;
}

function propertyText(id: string, names: PlaceNames): string {
  return names.properties.get(id) ?? 'cơ sở chưa rõ tên';
}

export function targetText(
  option: { readonly targetRoomId: string | null; readonly targetPropertyId: string | null },
  names: PlaceNames,
): string {
  const { targetRoomId, targetPropertyId } = option;
  if (targetRoomId !== null)
    return targetPropertyId === null
      ? roomText(targetRoomId, names)
      : `${roomText(targetRoomId, names)} · ${propertyText(targetPropertyId, names)}`;
  return targetPropertyId === null ? '—' : propertyText(targetPropertyId, names);
}

const MOVE_TYPE: Record<MoveType, string> = {
  SAME_TYPE_SAME_PROPERTY: 'Cùng loại phòng, cùng cơ sở',
  UPGRADE_SAME_PROPERTY: 'Nâng hạng cùng cơ sở',
  SAME_TYPE_CROSS_PROPERTY: 'Cùng loại phòng, cơ sở khác',
  UPGRADE_CROSS_PROPERTY: 'Nâng hạng sang cơ sở khác',
  WALK_OUT: 'Chuyển khách sang khách sạn khác',
  SPLIT_ROOMS: 'Tách phòng',
  MERGE_SHARE: 'Ghép ở chung',
  MERGE_CONNECTING: 'Ghép phòng thông nhau',
};

export function moveTypeText(type: MoveType): string {
  return MOVE_TYPE[type];
}

const MOVE_STATUS: Record<RoomMoveStatus, string> = {
  PROPOSED: 'chờ duyệt',
  APPROVED: 'đã duyệt, chờ thực hiện',
  EXECUTED: 'đã thực hiện',
  REJECTED: 'bị từ chối',
  CANCELLED: 'đã huỷ',
};

export function moveStatusText(status: RoomMoveStatus): string {
  return MOVE_STATUS[status];
}

const ACTION: Record<'APPROVE' | 'EXECUTE' | 'CANCEL', string> = {
  APPROVE: 'duyệt',
  EXECUTE: 'thực hiện',
  CANCEL: 'huỷ',
};

export function actionText(actions: readonly ('APPROVE' | 'EXECUTE' | 'CANCEL')[]): string {
  return actions.length === 0 ? 'không có' : actions.map((action) => ACTION[action]).join(', ');
}
