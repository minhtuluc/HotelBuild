import { emptyRowsFor, type AllotmentDraftRow } from '../../../lib/allotments';
import type { AdminState, AdminData } from '../admin-commands/model';
export interface Editor {
  key: string;
  revision: number;
  tag: string;
  rows: readonly AllotmentDraftRow[];
}
export type Current = NonNullable<AdminData['allotment']>;
export function selectionKey(current: Current | undefined): string {
  return current
    ? JSON.stringify([current.propertyId, current.channelId, current.roomTypeId, current.range])
    : '';
}
export function visibleEditor(
  state: AdminState,
  editor: Editor | null,
  key: string,
): Editor | null {
  return editor?.key === key && editor.revision === state.actorRevision ? editor : null;
}
export function displayRows(
  current: Current | undefined,
  editor: Editor | null,
): readonly AllotmentDraftRow[] {
  if (!current) return [];
  return (editor?.rows ?? emptyRowsFor(current.range, current.rows)).map((row) => ({
    ...row,
    used: current.rows.find((item) => item.date === row.date)?.used,
  }));
}
export function sellingUnits(state: AdminState, current: Current | undefined): number | undefined {
  return state.data?.roomTypes.find((type) => type.id === current?.roomTypeId)?.sellingUnits;
}
