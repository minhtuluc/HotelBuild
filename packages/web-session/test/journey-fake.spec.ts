import { afterEach, beforeEach, expect, test } from 'vitest';
import { startFakeApi } from '../../../tests/e2e/fake-api/server.js';
import {
  availabilitySchema,
  listResponseSchema,
  ratePlanPublicSchema,
  quoteSchema,
  holdSchema,
  bookingSummarySchema,
  tokenPairSchema,
} from '@pinehill/contracts';
import { quoteInput, search, key, bookingInput } from './journey-fixtures.js';
let running: Awaited<ReturnType<typeof startFakeApi>>;
beforeEach(async () => {
  running = await startFakeApi('http://127.0.0.1:0/api/v1');
});
afterEach(async () => {
  running.server.closeAllConnections();
  await new Promise<void>((resolve) => running.server.close(() => resolve()));
});
async function call(
  path: string,
  body?: unknown,
  token?: string,
  method = body === undefined ? 'GET' : 'POST',
  idempotencyKey = key,
) {
  return fetch(running.url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function login(phone = '+84900000079', staff = false) {
  const response = await call(
    staff ? '/auth/login' : '/guest-auth/login',
    staff ? { username: phone, password: 'Synthetic-password' } : { phone, otp: '123456' },
  );
  return tokenPairSchema.parse(await response.json());
}
async function quoted(propertyId = 'journey-standard', token?: string) {
  const response = await call('/quotes', { ...quoteInput, propertyId }, token);
  expect(response.status).toBe(201);
  return quoteSchema.parse(await response.json());
}
test('public fixture availability and rate plans obey published contracts', async () => {
  const available = await call(
    '/inventory/availability?' +
      new URLSearchParams({ ...search, adults: '2', children: '0', roomCount: '1' }),
  );
  expect(available.status).toBe(200);
  expect(availabilitySchema.parse(await available.json()).data[0]?.nightlyFrom).toBe(1000000);
  const plans = await call('/rate-plans?propertyId=journey-standard');
  expect(plans.status).toBe(200);
  expect(listResponseSchema(ratePlanPublicSchema).parse(await plans.json()).data).toHaveLength(4);
});
test('valid quote, hold and booking share one synthetic price snapshot', async () => {
  const session = await login();
  const quote = await quoted('journey-standard', session.accessToken);
  const held = await call(
    '/holds',
    { ...search, propertyId: 'journey-standard', quoteId: quote.quoteId },
    session.accessToken,
  );
  expect(held.status).toBe(201);
  const hold = holdSchema.parse(await held.json());
  expect(hold.quotedTotal).toBe(quote.total);
  const created = await call(
    '/bookings',
    { ...bookingInput, propertyId: 'journey-standard', quoteId: quote.quoteId },
    session.accessToken,
  );
  expect(created.status).toBe(201);
  const booking = bookingSummarySchema.parse(await created.json());
  expect(booking.totalAmount).toBe(quote.total);
  expect(booking.duplicateSuspected).toBe(false);
  expect((await call(`/bookings/${booking.id}`, undefined, session.accessToken)).status).toBe(200);
  expect(
    (await call(`/holds/${hold.holdId}?reason=synthetic`, undefined, session.accessToken, 'DELETE'))
      .status,
  ).toBe(204);
});
test.each(['journey-expired', 'journey-taken'])(
  'scenario %s supplies required error',
  async (propertyId) => {
    const session = await login();
    const quote = await quoted(propertyId, session.accessToken);
    const response = await call(
      '/holds',
      { ...search, propertyId, quoteId: quote.quoteId },
      session.accessToken,
    );
    expect(response.status).toBe(propertyId === 'journey-expired' ? 410 : 409);
    expect(await response.json()).toMatchObject({
      code: propertyId === 'journey-expired' ? 'E_RATE_QUOTE_EXPIRED' : 'E_INV_ROOM_TAKEN',
    });
  },
);
test('duplicate warning and exact idempotent replay survive fixture HTTP', async () => {
  const session = await login();
  const quote = await quoted('journey-duplicate', session.accessToken);
  const body = { ...bookingInput, propertyId: 'journey-duplicate', quoteId: quote.quoteId };
  const first = await call('/bookings', body, session.accessToken);
  const result = bookingSummarySchema.parse(await first.json());
  expect(result.duplicateSuspected).toBe(true);
  const replay = await call('/bookings', body, session.accessToken);
  expect(await replay.json()).toEqual(result);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  const changed = await call('/bookings', { ...body, note: 'changed' }, session.accessToken);
  expect(changed.status).toBe(409);
});
test('no anonymous, invented, staff or other guest bearer can act as owner', async () => {
  const owner = await login();
  const other = await login('+84900000080');
  const staff = await login('synthetic-staff', true);
  const quote = await quoted('journey-standard', owner.accessToken);
  const body = { ...search, propertyId: 'journey-standard', quoteId: quote.quoteId };
  for (const token of [undefined, 'invented', staff.accessToken])
    expect((await call('/holds', body, token)).status).toBe(401);
  expect((await call('/holds', body, other.accessToken)).status).toBe(409);
});
test('rotation invalidates old access and logout invalidates the new access', async () => {
  const session = await login();
  const response = await call('/guest-auth/refresh', { refreshToken: session.refreshToken });
  const rotated = tokenPairSchema.parse(await response.json());
  const body = { ...search, propertyId: 'journey-standard', quoteId: 'unknown' };
  expect((await call('/holds', body, session.accessToken)).status).toBe(401);
  expect((await call('/holds', body, rotated.accessToken)).status).toBe(410);
  expect((await call('/auth/logout', undefined, rotated.accessToken, 'POST')).status).toBe(204);
  expect((await call('/holds', body, rotated.accessToken)).status).toBe(401);
});
test('per-server state cannot leak a bearer or quote into another server', async () => {
  const session = await login();
  const quote = await quoted('journey-standard', session.accessToken);
  const second = await startFakeApi('http://127.0.0.1:0/api/v1');
  try {
    const response = await fetch(second.url + '/holds', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ ...search, quoteId: quote.quoteId }),
    });
    expect(response.status).toBe(401);
  } finally {
    second.server.closeAllConnections();
    await new Promise<void>((resolve) => second.server.close(() => resolve()));
  }
});
test('public quote retries reuse the same snapshot and reject key reuse with another body', async () => {
  const first = await call('/quotes', quoteInput);
  const value = quoteSchema.parse(await first.json());
  const replay = await call('/quotes', quoteInput);
  expect(await replay.json()).toEqual(value);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await call('/quotes', { ...quoteInput, adults: 3 })).status).toBe(409);
});
test('release retry preserves the reply while a changed reason cannot reuse the key', async () => {
  const session = await login();
  const quote = await quoted('journey-standard', session.accessToken);
  const response = await call(
    '/holds',
    { ...search, propertyId: 'journey-standard', quoteId: quote.quoteId },
    session.accessToken,
  );
  const hold = holdSchema.parse(await response.json());
  const path = `/holds/${hold.holdId}?reason=synthetic`;
  expect((await call(path, undefined, session.accessToken, 'DELETE')).status).toBe(204);
  const replay = await call(path, undefined, session.accessToken, 'DELETE');
  expect(replay.status).toBe(204);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect(
    (await call(`/holds/${hold.holdId}?reason=changed`, undefined, session.accessToken, 'DELETE'))
      .status,
  ).toBe(409);
});
test('quote principal and price inputs cannot be substituted when booking', async () => {
  const owner = await login();
  const other = await login('+84900000080');
  const response = await call(
    '/quotes',
    {
      ...quoteInput,
      propertyId: 'journey-standard',
      children: 1,
      childAges: [7],
      promotionCodes: ['SYNTH'],
    },
    owner.accessToken,
  );
  const quote = quoteSchema.parse(await response.json());
  const body = {
    ...bookingInput,
    propertyId: 'journey-standard',
    children: 1,
    childAges: [7],
    promotionCodes: ['SYNTH'],
    quoteId: quote.quoteId,
  };
  for (const changed of [
    { ...body, promotionCodes: [] },
    { ...body, childAges: [8] },
  ]) {
    const invalid = await call('/bookings', changed, owner.accessToken);
    expect(invalid.status).toBe(409);
    expect(await invalid.json()).toMatchObject({ code: 'E_RATE_QUOTE_MISMATCH' });
  }
  const wrongPrincipal = await call('/bookings', body, other.accessToken);
  expect(wrongPrincipal.status).toBe(409);
  expect(await wrongPrincipal.json()).toMatchObject({ code: 'E_RATE_QUOTE_MISMATCH' });
  const created = await call('/bookings', body, owner.accessToken);
  const booking = bookingSummarySchema.parse(await created.json());
  for (const path of [`/bookings/${booking.id}`]) {
    const denied = await call(path, undefined, other.accessToken);
    expect(denied.status).toBe(404);
    expect(await denied.json()).toMatchObject({ code: 'E_GEN_NOT_FOUND' });
  }
});
test('missing cached quote requests re-quote with the published 410 error', async () => {
  const session = await login();
  const response = await call('/holds', { ...search, quoteId: 'missing' }, session.accessToken);
  expect(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ code: 'E_RATE_QUOTE_EXPIRED' });
});
test('duplicate scenario returns the existing booking even with a new request key', async () => {
  const session = await login();
  const quote = await quoted('journey-duplicate', session.accessToken);
  const body = { ...bookingInput, propertyId: 'journey-duplicate', quoteId: quote.quoteId };
  const first = bookingSummarySchema.parse(
    await (await call('/bookings', body, session.accessToken)).json(),
  );
  const second = bookingSummarySchema.parse(
    await (await call('/bookings', body, session.accessToken, 'POST', crypto.randomUUID())).json(),
  );
  expect(second.id).toBe(first.id);
  expect(second.duplicateSuspected).toBe(true);
});
