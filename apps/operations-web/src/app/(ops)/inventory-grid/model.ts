import type { InventoryGrid, RoomTypeSummary } from '@pinehill/contracts';
import { gridDates, type GridRange } from '../../../lib/inventory-grid';
import type { GridData } from './controller';
export type InventoryGridCell = InventoryGrid['cells'][number];
function safeCounts(cell: InventoryGridCell): boolean {
  return (
    [cell.supply, cell.demand, cell.pool, cell.blocked].every(Number.isSafeInteger) &&
    [cell.supply, cell.demand, cell.blocked].every((n) => n >= 0) &&
    (cell.published === undefined || (Number.isSafeInteger(cell.published) && cell.published >= 0))
  );
}
export function projectGrid(
  propertyId: string,
  range: GridRange,
  types: readonly RoomTypeSummary[],
  grid: InventoryGrid,
): Omit<GridData, 'properties'> {
  const dates = gridDates(range.from, range.to);
  if (
    !dates.length ||
    grid.propertyId !== propertyId ||
    grid.from !== range.from ||
    grid.to !== range.to
  )
    throw Error('Mismatched grid');
  const grids = grid.grids ?? [grid];
  if (
    grids.length !== types.length ||
    new Set(grids.map((g) => g.roomTypeId)).size !== grids.length
  )
    throw Error('Incomplete grid types');
  const rows = types.map((type) => {
    const g = grids.find((item) => item.roomTypeId === type.id);
    if (
      type.propertyId !== propertyId ||
      !g ||
      g.propertyId !== propertyId ||
      g.from !== range.from ||
      g.to !== range.to
    )
      throw Error('Mismatched grid row');
    if (
      g.cells.length !== dates.length ||
      g.cells.some((cell, i) => cell.date !== dates[i] || !safeCounts(cell))
    )
      throw Error('Incomplete grid dates');
    return { roomTypeId: type.id, code: type.code, cells: g.cells };
  });
  return { propertyId, range, rows, capturedAt: grid.capturedAt ?? null };
}
