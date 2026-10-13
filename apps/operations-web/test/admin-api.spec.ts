import { expect, test } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { adminPorts } from '../src/app/(ops)/admin-commands/api';
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
const type = (id: string) => ({
  id,
  propertyId: 'p1',
  code: id,
  capacityAdults: 2,
  capacityChildren: 0,
  basePrice: 100000,
  minPrice: 100000,
  maxPrice: 100000,
  allowShared: false,
  bedCount: 2,
  version: 1,
});
function setup(mode = 'valid') {
  const paths: string[] = [];
  const client = new ApiClient({
    baseUrl: 'https://synthetic.test/api/session/sys',
    getAccessToken: () => 'synthetic-access',
    maxAttempts: 1,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      paths.push(url.href);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-access');
      const page = url.pathname.endsWith('/properties')
        ? { data: [property], meta: { limit: 100, total: 1, hasMore: false, nextCursor: null } }
        : {
            data: [type(url.searchParams.has('cursor') && mode !== 'loop' ? 'rt2' : 'rt1')],
            meta: {
              limit: 100,
              total: mode === 'partial' ? 3 : 2,
              hasMore: !url.searchParams.has('cursor') || mode === 'loop',
              nextCursor: 'next',
            },
          };
      return Response.json(page);
    },
  });
  return { port: adminPorts(client, 'room-type'), paths };
}
test('reads every room-type page with current staff bearer', async () => {
  const s = setup();
  const data = await s.port.read(new AbortController().signal);
  expect(data.roomTypes.map((r) => r.id)).toEqual(['rt1', 'rt2']);
  expect(s.paths).toHaveLength(3);
  expect(s.paths[2]).toContain('cursor=next');
});
test.each(['loop', 'partial'])(
  'rejects %s catalogue without publishing incomplete rows',
  async (mode) => {
    const s = setup(mode);
    await expect(s.port.read(new AbortController().signal)).rejects.toMatchObject({
      kind: 'protocol',
    });
  },
);
