import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { GET as availability } from '../../src/app/api/session/sys/inventory/availability/route';
import { GET as ratePlans } from '../../src/app/api/session/sys/rate-plans/route';

/**
 * HB-201 AC2 — hai tuyến BFF mới mà màn SCR-33/34 (tạo booking) cần: `GET inventory/availability` và
 * `GET rate-plans`. Ca này chạy **route thật** qua TCP tới API giả để chứng minh: bearer của phiên đi
 * tiếp, khoá truy vấn lạ bị từ chối ở BFF, khoá truy vấn hợp lệ được chuyển nguyên sang API, và không
 * có header riêng của API rò về trình duyệt.
 */
delete process.env.SESSION_APP_ORIGIN;

const paths: string[] = [];
const server = createServer((req, res) => {
  assert.equal(req.headers.authorization, 'Bearer synthetic-access');
  paths.push(req.url ?? '');
  res.writeHead(200, {
    'content-type': 'application/json',
    'set-cookie': 'synthetic-private-upstream=hidden',
  });
  res.end(
    JSON.stringify(
      req.url?.startsWith('/api/v1/inventory/availability')
        ? {
            checkIn: '2026-12-24',
            checkOut: '2026-12-26',
            nights: 2,
            data: [
              {
                propertyId: 'p1',
                roomTypeId: 'rt1',
                roomTypeCode: 'STD',
                roomTypeName: 'Phòng tiêu chuẩn',
                capacityAdults: 2,
                availableCount: 3,
                soldOut: false,
                minNights: 1,
                maxNights: 365,
                nightlyFrom: 1_000_000,
                totalFrom: 2_000_000,
              },
            ],
            meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 },
          }
        : {
            data: [
              {
                code: 'FLEX7',
                name: 'Linh hoạt 7 ngày',
                minNights: 1,
                maxNights: 365,
                depositPercent: 30,
              },
            ],
            meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 },
          },
    ),
  );
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('TCP');
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:' + address.port + '/api/v1';

  const request = (path: string, auth = 'Bearer synthetic-access') =>
    new Request('https://ops.test/api/session/sys/' + path, { headers: { authorization: auth } });

  const available = await availability(
    request(
      'inventory/availability?propertyId=p1&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0&roomCount=1',
    ),
  );
  assert.equal(available.status, 200);
  assert.equal(available.headers.get('set-cookie'), null);
  assert.equal(available.headers.get('cache-control'), 'no-store');
  assert.equal(paths[0]?.startsWith('/api/v1/inventory/availability?'), true);
  assert.equal(paths[0]?.includes('roomCount=1'), true);
  assert.equal(paths[0]?.includes('checkIn=2026-12-24'), true);

  const plans = await ratePlans(
    request('rate-plans?propertyId=p1&checkIn=2026-12-24&checkOut=2026-12-26'),
  );
  assert.equal(plans.status, 200);
  assert.equal(paths[1]?.startsWith('/api/v1/rate-plans?'), true);
  assert.equal(paths[1]?.includes('propertyId=p1'), true);

  // Khoá lạ bị từ chối ở BFF, không chuyển tiếp mù sang API.
  assert.equal((await ratePlans(request('rate-plans?nope=1'))).status, 400);
  assert.equal(
    (await availability(request('inventory/availability?propertyId=p1&sort=name'))).status,
    400,
  );
  // Kỳ lưu trú không hợp lệ (ra trước vào) cũng dừng ở BFF.
  assert.equal(
    (
      await availability(
        request(
          'inventory/availability?propertyId=p1&checkIn=2026-12-26&checkOut=2026-12-24&adults=2&children=0&roomCount=1',
        ),
      )
    ).status,
    400,
  );
  assert.equal(paths.length, 2);

  // Thiếu bearer ⇒ 401, không có request nào ra API; tuyến ngoài phạm vi BFF ⇒ 404.
  assert.equal(
    (
      await availability(
        request(
          'inventory/availability?propertyId=p1&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0&roomCount=1',
          '',
        ),
      )
    ).status,
    401,
  );
  assert.equal((await ratePlans(request('rate-plans', ''))).status, 401);
  assert.equal((await ratePlans(request('bookings'))).status, 404);
  assert.equal(paths.length, 2);

  process.stdout.write(
    JSON.stringify({
      actualRoutes: true,
      bearer: true,
      strictQuery: true,
      availabilityQuery: true,
      ratePlanQuery: true,
      privateHeadersStripped: true,
    }),
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
