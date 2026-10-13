import { errorBodySchema } from '@pinehill/contracts';
import { createServer } from 'node:http';
import { expect, test } from 'vitest';
import { createJourneyHandler } from '../src/server.js';
const field = 'items[2026-11-01].allotment';
test('trusted quota validation opt-in keeps all31 approved dates for409 and strips private details', async () => {
  const fields = Array.from(
    { length: 31 },
    (_, i) => `items[2026-11-${String(i + 1).padStart(2, '0')}].allotment`,
  );
  const server = createServer((_req, res) => {
    res.writeHead(409, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        code: 'E_INV_ALLOTMENT_EXCEEDS_ROOMS',
        message: 'synthetic-private',
        traceId: 'synthetic',
        timestamp: '2026-11-01T00:00:00Z',
        path: '/channel-allotments',
        details: [
          ...fields.map((field) => ({ field, issue: 'EXCEEDS_ACTIVE_SUPPLY' })),
          { field: 'password', issue: 'SECRET' },
          { field, issue: 'synthetic-private' },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('TCP port');
  const request = () =>
    new Request('https://ops.test/api/session/sys/channel-allotments', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer synthetic-access',
        origin: 'https://ops.test',
        'x-session-request': '1',
        'idempotency-key': '7ed2bdb1-c3e0-467f-89e0-000000000001',
      },
    });
  const options = {
    baseUrl: 'http://127.0.0.1:' + address.port + '/api/v1',
    routeResolver: () => ({ method: 'PUT' as const, path: '/channel-allotments', protected: true }),
    validationFields: fields,
  };
  try {
    const standard = await createJourneyHandler(options)(request());
    expect(standard.status).toBe(409);
    expect(errorBodySchema.parse(await standard.json()).details).toBeUndefined();
    const response = await createJourneyHandler({
      ...options,
      validationErrorCodes: ['E_INV_ALLOTMENT_EXCEEDS_ROOMS'],
    })(request());
    expect(response.status).toBe(409);
    const body = errorBodySchema.parse(await response.json());
    expect(body.details).toEqual(
      fields.map((field) => ({ field, issue: 'EXCEEDS_ACTIVE_SUPPLY' })),
    );
    expect(JSON.stringify(body)).not.toContain('synthetic-private');
    expect(JSON.stringify(body)).not.toContain('password');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
