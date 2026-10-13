import { expect, test } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { adminPorts } from '../src/app/(ops)/admin-commands/api';
const body = {
  roomId: 'r1',
  startDate: '2026-11-01',
  endDate: '2026-11-04',
  reason: 'MAINTENANCE' as const,
};
const key = 'babc0000-0000-4000-8000-000000000001';
const signal = () => new AbortController().signal;

function setup(
  reply: unknown = { ...body, id: 'b1', note: null },
  createStatus = 201,
  deleteStatus = 204,
) {
  const requests: { path: string; method: string; body: unknown; key: string | null }[] = [];
  const client = new ApiClient({
    baseUrl: 'https://synthetic.test/api/session/sys',
    getAccessToken: () => 'synthetic-access',
    maxAttempts: 1,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        path: url.pathname + url.search,
        method: init?.method ?? 'GET',
        body: init?.body,
        key: new Headers(init?.headers).get('idempotency-key'),
      });
      if (init?.method === 'DELETE') return new Response(null, { status: deleteStatus });
      if (init?.method === 'POST') return Response.json(reply, { status: createStatus });
      return Response.json({
        data: [],
        meta: { limit: 100, total: 0, hasMore: false, nextCursor: null },
      });
    },
  });
  return { ports: adminPorts(client, 'room-block'), requests };
}
test('POST uses published room-block body and typed201 receipt, without If-Match or response fields', async () => {
  const s = setup();
  expect(await s.ports.write({ kind: 'room-block-create', body }, key, signal())).toEqual({
    kind: 'room-block-create',
    data: { ...body, id: 'b1', note: null },
  });
  expect(s.requests).toEqual([
    { path: '/api/session/sys/room-blocks', method: 'POST', body: JSON.stringify(body), key },
  ]);
});
test('DELETE puts required reason in query, sends once, and accepts empty204', async () => {
  const s = setup();
  expect(
    await s.ports.write(
      { kind: 'room-block-delete', targetId: 'b1', reason: 'Synthetic repaired & checked' },
      key,
      signal(),
    ),
  ).toEqual({ kind: 'room-block-delete', id: 'b1' });
  expect(s.requests).toHaveLength(1);
  const request = s.requests[0]!;
  expect(new URL('https://synthetic.test' + request.path).searchParams.get('reason')).toBe(
    'Synthetic repaired & checked',
  );
  expect(request).toMatchObject({ method: 'DELETE', key, body: undefined });
});
test('mismatched acknowledged room/range is a protocol error and never accepted as own create', async () => {
  await expect(
    setup({ ...body, id: 'b1', note: null, roomId: 'r2' }).ports.write(
      { kind: 'room-block-create', body },
      key,
      signal(),
    ),
  ).rejects.toMatchObject({ kind: 'protocol' });
});
test('read completes scoped properties, physical rooms and room blocks', async () => {
  const s = setup();
  expect(await s.ports.read(signal())).toEqual({
    properties: [],
    roomTypes: [],
    rooms: [],
    blocks: [],
  });
  expect(s.requests.map((row) => row.path.split('?')[0])).toEqual([
    '/api/session/sys/properties',
    '/api/session/sys/rooms',
    '/api/session/sys/room-blocks',
  ]);
});

test('unpublished200 create and202 delete cannot settle a durable command', async () => {
  await expect(
    setup(undefined, 200).ports.write({ kind: 'room-block-create', body }, key, signal()),
  ).rejects.toMatchObject({ kind: 'protocol' });
  await expect(
    setup(undefined, 201, 202).ports.write(
      { kind: 'room-block-delete', targetId: 'b1', reason: 'Synthetic repaired' },
      key,
      signal(),
    ),
  ).rejects.toMatchObject({ kind: 'protocol' });
});
