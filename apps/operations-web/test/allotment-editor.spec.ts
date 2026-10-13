import { expect, test } from 'vitest';
import { changedItems, emptyRowsFor } from '../src/lib/allotments';
import { displayRows } from '../src/app/(ops)/channel-allotments/editor';
const range = { from: '2026-11-01', to: '2026-11-02' };
const initial = [
  { date: range.from, allotment: 5, used: 0 },
  { date: range.to, allotment: 6, used: 0 },
];
const editor = {
  key: 'synthetic',
  revision: 0,
  tag: '"3"',
  rows: emptyRowsFor(range, initial).map((row, i) => (i === 0 ? { ...row, value: '4' } : row)),
};
const current = {
  propertyId: 'p1',
  channelId: 'c1',
  roomTypeId: 'rt1',
  range,
  tag: '"4"',
  rows: [
    { date: range.from, allotment: 5, used: 1 },
    { date: range.to, allotment: 7, used: 2 },
  ],
};
test('conflict comparison refreshes untouched dates while retaining only explicitly changed input', () => {
  const rows = displayRows(current, editor);
  expect(rows.map((row) => row.value)).toEqual(['4', '7']);
  const adopted = rows.map((row) => ({
    ...row,
    original: current.rows.find((item) => item.date === row.date)?.allotment,
  }));
  expect(changedItems(adopted)).toEqual([{ date: range.from, allotment: 4 }]);
});
