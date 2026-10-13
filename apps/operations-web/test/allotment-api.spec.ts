import type { AdminCommand } from '../src/app/(ops)/admin-commands/intent';
import { expect, test } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { adminPorts } from '../src/app/(ops)/admin-commands/api';
const cmd: Extract<AdminCommand, { kind: 'allotment-put' }> = {
  kind: 'allotment-put',
  tag: '"9007199254740993"',
  range: { from: '2026-11-01', to: '2026-11-03' },
  body: { channelId: 'c1', roomTypeId: 'rt1', items: [{ date: '2026-11-01', allotment: 0 }] },
};
const property = {
  id: 'p1',
  name: 'Synthetic',
  status: 'ACTIVE',
  activeRoomCount: 1,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 1,
};
const type = {
  id: 'rt1',
  propertyId: 'p1',
  code: 'STD',
  capacityAdults: 2,
  capacityChildren: 0,
  basePrice: 100000,
  minPrice: 100000,
  maxPrice: 100000,
  allowShared: false,
  bedCount: 1,
  sellingUnits: 1,
  version: 1,
};
const channel = {
  id: 'c1',
  code: 'OTA_BOOKING',
  name: 'Synthetic',
  multiplier: 1,
  commissionPct: 15,
  holdMinutes: 30,
  overbookAllowed: false,
  version: 1,
};
function setup(tag = '"9007199254740994"', status = 204) {
  const calls: {
    path: string;
    method: string;
    key: string | null;
    match: string | null;
    marker: string | null;
    body: unknown;
  }[] = [];
  const client = new ApiClient({
    baseUrl: 'https://synthetic.test/api/session/sys',
    getAccessToken: () => 'synthetic-access',
    maxAttempts: 1,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input)),
        headers = new Headers(init?.headers);
      const call: (typeof calls)[number] = {
        path: url.pathname,
        method: init?.method ?? 'GET',
        key: headers.get('idempotency-key'),
        match: headers.get('if-match'),
        marker: headers.get('x-session-request'),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      if (call.method === 'PUT') return new Response(null, { status, headers: { etag: tag } });
      const data = url.pathname.endsWith('/properties')
        ? [property]
        : url.pathname.endsWith('/room-types')
          ? [type]
          : url.pathname.endsWith('/channels')
            ? [channel]
            : [{ date: '2026-11-01', allotment: 0, used: 2 }];
      return Response.json(
        { data, meta: { limit: 100, total: data.length, hasMore: false, nextCursor: null } },
        { headers: { etag: cmd.tag } },
      );
    },
  });
  return { ports: adminPorts(client, 'allotment'), calls };
}
test('reads configured rows with exact large ETag and complete catalogues', async () => {
  const s = setup();
  const read = await s.ports.read(new AbortController().signal, cmd);
  expect(read.allotment).toEqual({
    propertyId: 'p1',
    channelId: 'c1',
    roomTypeId: 'rt1',
    range: cmd.range,
    rows: [{ date: '2026-11-01', allotment: 0, used: 2 }],
    tag: cmd.tag,
  });
  expect(read.channels).toEqual([channel]);
});
test('onePUT sends exact batch/key/tag with marker and validates advanced204 receipt', async () => {
  const s = setup();
  const result = await s.ports.write(
    cmd,
    '7ed2bdb1-c3e0-467f-89e0-000000000001',
    new AbortController().signal,
  );
  expect(result).toEqual({
    kind: 'allotment-put',
    channelId: 'c1',
    roomTypeId: 'rt1',
    tag: '"9007199254740994"',
  });
  expect(s.calls).toEqual([
    {
      path: '/api/session/sys/channel-allotments',
      method: 'PUT',
      key: '7ed2bdb1-c3e0-467f-89e0-000000000001',
      match: cmd.tag,
      marker: '1',
      body: cmd.body,
    },
  ]);
});
test.each(['', 'invalid', '"0"', '"9007199254740993"', '"9223372036854775808"'])(
  'rejects malformed or nonadvancing204 tag %s',
  async (tag) => {
    const s = setup(tag);
    await expect(
      s.ports.write(cmd, '7ed2bdb1-c3e0-467f-89e0-000000000001', new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'protocol' });
    expect(s.calls).toHaveLength(1);
  },
);
