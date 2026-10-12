import { expect, test } from 'vitest';
import type { InventoryGrid, RoomTypeSummary } from '@pinehill/contracts';
import { projectGrid } from '../src/app/(ops)/inventory-grid/model';
const range = { from: '2026-11-01', to: '2026-11-01' };
const type: RoomTypeSummary = {
  id: 'rt1',
  propertyId: 'p1',
  code: 'STD',
  capacityAdults: 2,
  capacityChildren: 1,
  basePrice: 100000,
  minPrice: 100000,
  maxPrice: 100000,
  allowShared: false,
  bedCount: 2,
  version: 1,
};
const grid: InventoryGrid = {
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ...range,
  cells: [{ date: range.from, supply: 3, demand: 1, pool: 2, blocked: 0, published: 2 }],
};
test('projection preserves authoritative cells, type labels and server capture', () => {
  const data = projectGrid('p1', range, [type], { ...grid, capturedAt: '2026-10-13T00:00:00Z' });
  expect(data.rows[0]?.cells).toEqual(grid.cells);
  expect(data.rows[0]?.code).toBe('STD');
  expect(data.capturedAt).toBe('2026-10-13T00:00:00Z');
});
test('partial duplicate foreign or unsafe projections cannot become a complete grid', () => {
  for (const invalid of [
    { ...grid, cells: [] },
    { ...grid, grids: [grid, grid] },
    { ...grid, propertyId: 'p2' },
    { ...grid, cells: [{ ...grid.cells[0]!, date: '2026-11-02' }] },
    { ...grid, cells: [{ ...grid.cells[0]!, pool: Number.MAX_SAFE_INTEGER + 1 }] },
  ])
    expect(() => projectGrid('p1', range, [type], invalid)).toThrow();
});
test('cell display uses server published fact when supplied instead of recomputing pool', async () => {
  const { cellText } = await import('../src/app/(ops)/inventory-grid/grid-table');
  expect(
    cellText({ date: range.from, supply: 100, demand: 1, pool: 99, blocked: 0, published: 7 }),
  ).toBe('· 7');
});
