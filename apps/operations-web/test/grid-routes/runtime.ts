import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { GET as properties } from '../../src/app/api/session/sys/properties/route';
import { GET as types } from '../../src/app/api/session/sys/room-types/route';
import { GET as grid } from '../../src/app/api/session/sys/inventory/grid/route';
delete process.env.SESSION_APP_ORIGIN;
const paths: string[] = [];
let deny = false;
const server = createServer((req, res) => {
  assert.equal(req.headers.authorization, 'Bearer synthetic-access');
  paths.push(req.url ?? '');
  res.writeHead(deny ? 403 : 200, {
    'content-type': 'application/json',
    'set-cookie': 'synthetic-private-upstream=hidden',
  });
  res.end(
    JSON.stringify(
      deny
        ? {
            code: 'E_AUTH_OUT_OF_SCOPE',
            message: 'denied',
            traceId: 'synthetic403',
            timestamp: '2026-10-13T00:00:00Z',
            path: '/api/v1/inventory/grid',
          }
        : req.url?.includes('/inventory/grid')
          ? {
              propertyId: 'p1',
              roomTypeId: 'rt1',
              from: '2026-11-01',
              to: '2026-11-01',
              cells: [{ date: '2026-11-01', supply: 1, demand: 0, pool: 1, blocked: 0 }],
            }
          : { data: [], meta: { limit: 100, total: 0, hasMore: false, nextCursor: null } },
    ),
  );
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
try {
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('TCP');
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:' + address.port + '/api/v1';
  const request = (path: string, auth = 'Bearer synthetic-access') =>
    new Request('https://ops.test/api/session/sys/' + path, { headers: { authorization: auth } });
  const listing = await properties(request('properties?limit=100'));
  assert.equal(listing.status, 200);
  assert.equal(listing.headers.get('set-cookie'), null);
  assert.equal(listing.headers.get('cache-control'), 'no-store');
  assert.equal((await types(request('room-types?propertyId=p1&limit=100'))).status, 200);
  assert.equal(
    (await grid(request('inventory/grid?propertyId=p1&from=2026-11-01&to=2026-11-01'))).status,
    200,
  );
  assert.equal(paths.length, 3);
  for (const [handler, path] of [
    [properties, 'properties?sort=bad'],
    [types, 'room-types?limit=1&limit=2'],
    [grid, 'inventory/grid?propertyId=p1&from=2026-02-30&to=2026-03-01'],
    [grid, 'inventory/grid?propertyId=p1&from=0001-01-01&to=9999-12-31'],
  ] as const)
    assert.equal((await handler(request(path))).status, 400);
  assert.equal((await properties(request('properties', ''))).status, 401);
  assert.equal((await properties(request('system-settings'))).status, 404);
  assert.equal(paths.length, 3);
  deny = true;
  assert.equal(
    (await grid(request('inventory/grid?propertyId=p1&from=2026-11-01&to=2026-11-01'))).status,
    403,
  );
  assert.equal(paths.length, 4);
  process.stdout.write(
    JSON.stringify({
      actualRoutes: true,
      bearer: true,
      strictQuery: true,
      calendarBound: true,
      privateHeadersStripped: true,
      scopeDenial: true,
    }),
  );
} finally {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
}
