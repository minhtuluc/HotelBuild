import assert from 'node:assert/strict';
import { startFakeApi } from '../../../../tests/e2e/fake-api/server.js';
import { GET, POST, DELETE } from '../../src/app/api/session/journey/[...path]/route';
import { POST as login } from '../../src/app/api/session/login/route';
import { quoteSchema, holdSchema, bookingSummarySchema } from '@pinehill/contracts';
import {
  quoteInput,
  search,
  key,
  bookingInput,
} from '../../../../packages/web-session/test/journey-fixtures.js';
const running = await startFakeApi('http://127.0.0.1:0/api/v1');
process.env.NEXT_PUBLIC_API_BASE_URL = running.url;
process.env.SESSION_APP_ORIGIN = 'https://app.test';
function request(
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request('https://app.test/api/session/' + path, {
    method,
    headers: {
      origin: 'https://app.test',
      'x-session-request': '1',
      'idempotency-key': key,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
try {
  const availability = await GET(
    request(
      'journey/inventory/availability?propertyId=journey-standard&checkIn=2026-10-10&checkOut=2026-10-11&adults=2&children=0&roomCount=1',
      'GET',
    ),
  );
  assert.equal(availability.status, 200);
  assert.equal(availability.headers.get('cache-control'), 'no-store');
  assert.equal((await GET(request('journey/rate-plans', 'GET'))).status, 200);
  const publicQuote = await POST(request('journey/quotes', 'POST', quoteInput));
  assert.equal(publicQuote.status, 201);
  const signIn = await login(
    request('login', 'POST', { phone: '+84900000079', password: 'Synthetic-password' }),
  );
  const value: unknown = await signIn.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !('accessToken' in value) ||
    typeof value.accessToken !== 'string'
  )
    throw new Error('Missing access');
  const cookie = signIn.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.equal(
    (await POST(request('journey/holds', 'POST', { ...search, quoteId: 'unknown' }, { cookie })))
      .status,
    401,
  );
  const headers = { authorization: `Bearer ${value.accessToken}`, cookie };
  const quoted = await POST(
    request('journey/quotes', 'POST', { ...quoteInput, propertyId: 'journey-standard' }, headers),
  );
  assert.equal(quoted.status, 201);
  const quote = quoteSchema.parse(await quoted.json());
  const held = await POST(
    request(
      'journey/holds',
      'POST',
      { ...search, propertyId: 'journey-standard', quoteId: quote.quoteId },
      headers,
    ),
  );
  assert.equal(held.status, 201);
  const hold = holdSchema.parse(await held.json());
  assert.equal(hold.quotedTotal, quote.total);
  const input = { ...bookingInput, propertyId: 'journey-standard', quoteId: quote.quoteId };
  const created = await POST(request('journey/bookings', 'POST', input, headers));
  assert.equal(created.status, 201);
  const booking = bookingSummarySchema.parse(await created.json());
  assert.equal(booking.totalAmount, quote.total);
  const replay = await POST(request('journey/bookings', 'POST', input, headers));
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(await replay.json(), booking);
  assert.equal(
    (await GET(request(`journey/bookings/${booking.id}`, 'GET', undefined, headers))).status,
    200,
  );
  assert.equal(
    (
      await POST(
        request('journey/bookings', 'POST', input, { ...headers, origin: 'https://evil.test' }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await DELETE(
        request(`journey/holds/${hold.holdId}?reason=synthetic`, 'DELETE', undefined, headers),
      )
    ).status,
    204,
  );
  assert.equal(created.headers.get('set-cookie'), null);
  assert.equal(JSON.stringify(booking).includes(value.accessToken), false);
  assert.equal(JSON.stringify(booking).includes('synthetic-refresh'), false);
  process.stdout.write(
    JSON.stringify({
      publicSearch: true,
      publicQuote: true,
      sessionRequired: true,
      authenticatedWrites: true,
      replay: true,
      csrf: true,
      release: true,
      secretsFiltered: true,
    }),
  );
} finally {
  running.server.closeAllConnections();
  await new Promise<void>((resolve) => running.server.close(() => resolve()));
}
