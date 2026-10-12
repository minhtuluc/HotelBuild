import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { gridPort } from '../src/app/(ops)/inventory-grid/api';
const range = { from: '2026-11-01', to: '2026-11-03' };
const property = {
  id: 'p1',
  name: 'Synthetic',
  status: 'ACTIVE',
  activeRoomCount: 2,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 1,
};
const type = (id: string) => ({
  id,
  propertyId: 'p1',
  code: id,
  capacityAdults: 2,
  capacityChildren: 1,
  basePrice: 100000,
  minPrice: 100000,
  maxPrice: 100000,
  allowShared: false,
  bedCount: 2,
  version: 1,
});
const grid = (id: string) => ({
  propertyId: 'p1',
  roomTypeId: id,
  ...range,
  cells: ['2026-11-01', '2026-11-02', '2026-11-03'].map((date) => ({
    date,
    supply: 3,
    demand: 1,
    pool: 2,
    blocked: 0,
    published: 2,
  })),
});
const responseGrid = () => ({
  ...grid('rt1'),
  grids: [grid('rt1'), grid('rt2')],
  capturedAt: '2026-10-13T00:00:00Z',
});
let server: Server,
  baseUrl = '',
  loop = false,
  partial = false;
const calls: { url: string; auth: string | undefined }[] = [];
const page = (
  data: unknown[],
  total = data.length,
  hasMore = false,
  nextCursor: string | null = null,
) => ({ data, meta: { limit: 100, total, hasMore, nextCursor } });
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '', 'http://synthetic.test');
    calls.push({ url: req.url ?? '', auth: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname.endsWith('/properties')) return res.end(JSON.stringify(page([property])));
    if (url.pathname.endsWith('/room-types'))
      return res.end(
        JSON.stringify(
          loop
            ? page([type('rt1')], 2, true, 'cursor1')
            : url.searchParams.has('cursor')
              ? page([type('rt2')], 2)
              : page([type('rt1')], 2, true, 'cursor1'),
        ),
      );
    const value = responseGrid();
    if (partial) value.grids[1]!.cells.pop();
    return res.end(JSON.stringify(value));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('TCP');
  baseUrl = 'http://127.0.0.1:' + a.port + '/api/session/sys';
});
afterAll(() => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))));
beforeEach(() => {
  calls.length = 0;
  loop = false;
  partial = false;
});
function port() {
  return gridPort(
    new ApiClient({ baseUrl, getAccessToken: () => 'synthetic-access', maxAttempts: 1 }),
  );
}
test('realTCP reads complete catalogues and exactly one all-type grid with same staff bearer', async () => {
  const data = await port()('p1', range, new AbortController().signal);
  expect(data.rows.map((r) => r.code)).toEqual(['rt1', 'rt2']);
  expect(data.capturedAt).toBe('2026-10-13T00:00:00Z');
  expect(calls.every((c) => c.auth === 'Bearer synthetic-access')).toBe(true);
  const grids = calls.filter((c) => c.url.includes('/inventory/grid'));
  expect(grids).toHaveLength(1);
  expect(grids[0]?.url).not.toContain('roomTypeId');
  expect(calls.filter((c) => c.url.includes('/room-types'))).toHaveLength(2);
});
test('catalogue cursor loop fails closed before any grid request', async () => {
  loop = true;
  await expect(port()('p1', range, new AbortController().signal)).rejects.toThrow();
  expect(calls.filter((c) => c.url.includes('/inventory/grid'))).toHaveLength(0);
  expect(calls).toHaveLength(3);
});
test('partial type/day projection never silently becomes zero inventory', async () => {
  partial = true;
  await expect(port()('p1', range, new AbortController().signal)).rejects.toThrow(
    'Incomplete grid dates',
  );
});
