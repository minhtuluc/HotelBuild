import type { RoomBlock } from '@pinehill/contracts';
import type { AdminState } from '../admin-commands/model';
import type { RoomBlockDraft } from '../../../lib/room-blocks';
import { chooseProperty } from '../../../lib/working-property';
export interface Editor {
  propertyId: string;
  revision: number;
  data: RoomBlockDraft;
}
export interface Removal {
  propertyId: string;
  revision: number;
  block: RoomBlock;
  reason: string;
}
/** Cơ sở đang xem: lựa chọn trên màn > cơ sở đang làm việc > cơ sở đầu (TD-44, HB-320). */
export function selection(state: AdminState, chosenId: string, working = '') {
  const data = state.data;
  if (!data)
    return { properties: [], propertyId: '', rooms: [], blocks: [], roomIds: new Set<string>() };
  const propertyId = chooseProperty(data.properties, chosenId, working);
  const rooms = (data.rooms ?? []).filter((row) => row.propertyId === propertyId);
  const roomIds = new Set(rooms.map((row) => row.id));
  const blocks = (data.blocks ?? []).filter((row) => roomIds.has(row.roomId));
  return { properties: data.properties, propertyId, rooms, blocks, roomIds };
}
export function visibleDraft(
  state: AdminState,
  editor: Editor | null,
  propertyId: string,
  roomIds: ReadonlySet<string>,
  initial: RoomBlockDraft,
): RoomBlockDraft {
  if (!editor || editor.propertyId !== propertyId || editor.revision !== state.actorRevision)
    return initial;
  if (editor.data.roomId !== '' && !roomIds.has(editor.data.roomId)) return initial;
  return editor.data;
}
export function visibleRemoval(
  state: AdminState,
  removal: Removal | null,
  propertyId: string,
  blocks: readonly RoomBlock[],
): Removal | null {
  if (
    !state.canRemove ||
    !removal ||
    removal.propertyId !== propertyId ||
    removal.revision !== state.actorRevision
  )
    return null;
  return blocks.some((row) => row.id === removal.block.id) ? removal : null;
}
