import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { GET as plans } from '../../src/app/api/session/sys/rate-plans/admin/route';
import { PUT as planPut } from '../../src/app/api/session/sys/rate-plans/[id]/route';
import { GET as policies } from '../../src/app/api/session/sys/cancellation-policies/route';
import { PUT as policyPut } from '../../src/app/api/session/sys/cancellation-policies/[id]/route';
import { plan, policy, command, policyCommand } from './fixture';
delete process.env.SESSION_APP_ORIGIN;
let count = 0,
  fail = false;
const server = createServer((request, response) => {
  void (async () => {
    count++;
    assert.equal(request.headers.authorization, 'Bearer synthetic-access');
    const requestBody = await readJson(request);
    if (request.method === 'PUT') {
      assert.equal(request.headers['if-match'], '"1"');
      assert.equal(request.headers['idempotency-key'], '00000000-0000-4000-8000-000000000010');
    }
    response.setHeader('set-cookie', 'SYNTHETIC_PRIVATE=hidden');
    if (fail) {
      response.writeHead(422, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          code: 'E_RATE_CONFIGURATION_INVALID',
          message: 'SYNTHETIC_PRIVATE',
          traceId: 'synthetic',
          timestamp: '2026-10-13T00:00:00Z',
          path: '/api/v1/cancellation-policies/' + policy.id,
          details: [
            { field: 'tiers[0].chargeFirstNight', issue: 'REFUND_WITH_FIRST_NIGHT_CHARGE' },
            { field: 'tiers[0].guestName', issue: 'SYNTHETIC_PRIVATE' },
          ],
        }),
      );
      return;
    }
    if (request.method === 'PUT' && request.url?.includes('/rate-plans/')) {
      assert.deepEqual(requestBody, command.body);
      response.writeHead(204);
      response.end();
      return;
    }
    const body =
      request.method === 'PUT'
        ? { ...policy, version: 2 }
        : {
            data: request.url?.includes('/rate-plans/admin') ? [plan] : [policy],
            meta: { limit: 100, total: 1, hasMore: false, nextCursor: null },
          };
    if (request.method === 'PUT') assert.deepEqual(requestBody, policyCommand.body);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  })().catch((error) => response.destroy(error instanceof Error ? error : undefined));
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
try {
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:' + address.port + '/api/v1';
  const make = (path: string, body?: unknown, extra?: Record<string, string>) =>
    new Request('https://ops.test/api/session/sys/' + path, {
      method: body === undefined ? 'GET' : 'PUT',
      headers: {
        authorization: 'Bearer synthetic-access',
        origin: 'https://ops.test',
        'x-session-request': '1',
        'content-type': 'application/json',
        'idempotency-key': '00000000-0000-4000-8000-000000000010',
        'if-match': '"1"',
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal((await plans(make('rate-plans/admin?limit=100'))).status, 200);
  assert.equal((await policies(make('cancellation-policies?limit=100'))).status, 200);
  assert.equal((await planPut(make('rate-plans/' + plan.id, command.body))).status, 204);
  const written = await policyPut(make('cancellation-policies/' + policy.id, policyCommand.body));
  assert.equal(written.status, 200);
  assert.equal(written.headers.get('set-cookie'), null);
  assert.equal(written.headers.get('cache-control'), 'no-store');
  const writtenBody: unknown = await written.json();
  assert.deepEqual(writtenBody, { ...policy, version: 2 });
  const before = count;
  assert.equal((await plans(make('rate-plans/admin', {}, { authorization: '' }))).status, 404);
  assert.equal(
    (await plans(new Request('https://ops.test/api/session/sys/rate-plans/admin'))).status,
    401,
  );
  assert.equal((await plans(make('rate-plans/admin?limit=1&limit=2'))).status, 400);
  assert.equal((await planPut(make('rate-plans/admin', command.body))).status, 404);
  assert.equal(
    (
      await policyPut(
        make('cancellation-policies/' + policy.id, policyCommand.body, {
          origin: 'https://evil.test',
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await policyPut(
        make('cancellation-policies/' + policy.id, {
          ...policyCommand.body,
          guestName: 'SYNTHETIC_PRIVATE',
        }),
      )
    ).status,
    400,
  );
  assert.equal(count, before);
  fail = true;
  const error = await policyPut(make('cancellation-policies/' + policy.id, policyCommand.body));
  assert.equal(error.status, 422);
  const text = await error.text();
  assert(!text.includes('SYNTHETIC_PRIVATE'));
  const errorBody: unknown = JSON.parse(text);
  assert(errorBody !== null && typeof errorBody === 'object' && 'details' in errorBody);
  assert.deepEqual(errorBody.details, [
    { field: 'tiers[0].chargeFirstNight', issue: 'REFUND_WITH_FIRST_NIGHT_CHARGE' },
  ]);
  process.stdout.write(
    JSON.stringify({
      read: true,
      plan204: true,
      policy200: true,
      guards: true,
      rowErrors: true,
      privateStripped: true,
    }),
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    assert(chunk instanceof Uint8Array);
    chunks.push(Buffer.from(chunk));
  }

  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
}
