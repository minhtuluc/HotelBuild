import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createJourneyHandler } from '../src/server.js';
let baseUrl = '',
  calls = 0;
const server = createServer((request, response) => {
  void (async () => {
    for await (const chunk of request)
      if (!(chunk instanceof Uint8Array)) throw Error('Invalid chunk');
    calls++;
    response.writeHead(204);
    response.end();
  })().catch((error) => response.destroy(error instanceof Error ? error : undefined));
});
beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing owned port');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});
afterAll(
  async () =>
    new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done()))),
);
beforeEach(() => {
  calls = 0;
});
function request(body: string, authenticated = true, path = '/api/session/sys/synthetic') {
  return new Request('https://ops.test' + path, {
    method: 'POST',
    body,
    headers: {
      origin: 'https://ops.test',
      'x-session-request': '1',
      'idempotency-key': '00000000-0000-4000-8000-000000000010',
      ...(authenticated ? { authorization: 'Bearer synthetic-access' } : {}),
    },
  });
}
function handler(maxBodyBytes?: number, protectedRoute = true) {
  return createJourneyHandler({
    baseUrl,
    routeResolver: () => ({
      method: 'POST',
      path: '/synthetic',
      protected: protectedRoute,
      body: { parse: (value: unknown) => value },
      ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
    }),
  });
}
test('trusted protected route admits larger bodies only inside its bounded byte budget', async () => {
  const write = handler(32768);
  expect((await write(request('{}'.padEnd(20000, ' ')))).status).toBe(204);
  expect(calls).toBe(1);
  expect((await write(request('{}'.padEnd(32769, ' ')))).status).toBe(400);
  expect(calls).toBe(1);
});
test('default staff and guest routes keep their original small byte budget', async () => {
  const body = '{}'.padEnd(16385, ' ');
  expect((await handler()(request(body))).status).toBe(400);
  expect(
    (await createJourneyHandler({ baseUrl })(request(body, false, '/api/session/journey/quotes')))
      .status,
  ).toBe(400);
  expect(calls).toBe(0);
});
test.each([0, 1.5, NaN, Infinity, 1048577])(
  'misconfigured budget %s cannot forward even a small request',
  async (limit) => {
    expect((await handler(limit)(request('{}'))).status).toBe(400);
    expect(calls).toBe(0);
  },
);
test('public routes cannot opt into the larger staff body budget', async () => {
  expect((await handler(1048576, false)(request('{}', false))).status).toBe(400);
  expect(calls).toBe(0);
});
test('authentication still rejects the large body before transport', async () => {
  expect((await handler(1048576)(request('{}'.padEnd(20000, ' '), false))).status).toBe(401);
  expect(calls).toBe(0);
});
test('streamed budget counts bytes including multibyte input', async () => {
  const body = JSON.stringify({ reason: 'é'.repeat(20) });
  expect((await handler(40)(request(body))).status).toBe(400);
  expect(calls).toBe(0);
});
