import { expect, test } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { adminPorts } from '../src/app/(ops)/admin-commands/api';
const room = {
  id: 'r1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code: 'CS01-101',
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: 'r2',
  version: 1789876543123460,
};
const command = {
  kind: 'connecting-update' as const,
  targetId: 'r1',
  tag: '"1789876543123456"',
  body: { connectingRoomId: 'r2' },
};
function port(reply: unknown) {
  return adminPorts(
    new ApiClient({
      baseUrl: 'https://synthetic.test/api/session/sys',
      getAccessToken: () => 'synthetic-access',
      maxAttempts: 1,
      fetchImpl: async (input) =>
        new URL(String(input)).pathname.endsWith('/room-types')
          ? Response.json({
              data: [],
              meta: { limit: 100, total: 0, hasMore: false, nextCursor: null },
            })
          : Response.json(reply),
    }),
    'connecting',
  );
}
test.each([1789876543123456, 1789876543123455])(
  'connecting receipt must advance exact room version beyond command tag (%s)',
  async (version) => {
    await expect(
      port({ ...room, version }).write(
        command,
        'babc0000-0000-4000-8000-000000000001',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: 'protocol' });
  },
);
test('unsafe room version catalogue is rejected before display', async () => {
  const list = {
    data: [{ ...room, version: Number.MAX_SAFE_INTEGER + 1 }],
    meta: { limit: 100, total: 1, hasMore: false, nextCursor: null },
  };
  await expect(port(list).read(new AbortController().signal)).rejects.toMatchObject({
    kind: 'protocol',
  });
});
