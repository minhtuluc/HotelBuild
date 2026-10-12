import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { GridTable } from '../src/app/(ops)/inventory-grid/grid-table';
function render(published?: number) {
  return renderToStaticMarkup(
    createElement(GridTable, {
      dates: ['2026-11-01'],
      rows: [
        {
          roomTypeId: 'rt1',
          code: 'STD',
          cells: [
            {
              date: '2026-11-01',
              supply: 100,
              demand: 1,
              pool: 99,
              blocked: 0,
              ...(published === undefined ? {} : { published }),
            },
          ],
        },
      ],
      focus: { row: 0, col: 0 },
      onFocusChange: () => {},
    }),
  );
}
test('actual rendered grid uses authoritative published in visible and accessible cell text', () => {
  const html = render(7);
  expect(html).toMatch(/>· 7<\/td>/);
  expect(html).toContain('còn 7');
  expect(html).not.toContain('còn 99');
});
test('actual rendered grid retains legacy pool fallback when published absent', () => {
  expect(render()).toMatch(/>· 99<\/td>/);
});
