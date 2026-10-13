import { afterEach, expect, test, vi } from 'vitest';
vi.mock('@pinehill/web-session/client', () => ({
  createSessionClient: () => ({
    getAccessToken: async () => 'synthetic-access',
    dispose: () => {},
  }),
}));
import { createAdminWorkspace } from '../src/app/(ops)/admin-commands/api';
import { intentStorageKey, type AdminCommand } from '../src/app/(ops)/admin-commands/intent';
afterEach(() => vi.unstubAllGlobals());
test('restored nondefault pair/range survives receipt and forgetting the completed intent', async () => {
  const stored = new Map<string, string>(),
    queries: URL[] = [];
  const command: Extract<AdminCommand, { kind: 'allotment-put' }> = {
    kind: 'allotment-put',
    tag: '"7"',
    range: { from: '2026-11-01', to: '2026-11-03' },
    body: { channelId: 'c1', roomTypeId: 'rt1', items: [{ date: '2026-11-01', allotment: 1 }] },
  };
  stored.set(
    intentStorageKey('manager1', 'allotment'),
    JSON.stringify({
      ownerId: 'manager1',
      key: '7ed2bdb1-c3e0-467f-89e0-000000000001',
      createdAt: Date.now(),
      command,
    }),
  );
  vi.stubGlobal('window', {
    location: { origin: 'https://synthetic.test' },
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === 'PUT')
      return new Response(null, { status: 204, headers: { etag: '"8"' } });
    if (url.pathname.endsWith('/auth/me'))
      return Response.json({
        userId: 'manager1',
        username: 'synthetic',
        fullName: 'Synthetic',
        role: 'MANAGER',
        propertyScope: ['p1'],
        hasPin: true,
        mustChangePassword: false,
      });
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
    if (url.pathname.endsWith('/channel-allotments')) queries.push(url);
    const data = url.pathname.endsWith('/properties')
      ? [property]
      : url.pathname.endsWith('/room-types')
        ? [type]
        : url.pathname.endsWith('/channels')
          ? [{ ...channel, id: 'c0', code: 'WEB' }, channel]
          : [{ date: '2026-11-01', allotment: 1, used: 0 }];
    return Response.json(
      { data, meta: { limit: 100, total: data.length, hasMore: false, nextCursor: null } },
      { headers: { etag: '"8"' } },
    );
  });
  const workspace = createAdminWorkspace('allotment', {
    range: { from: '2026-12-01', to: '2026-12-03' },
  });
  try {
    await workspace.controller.load();
    expect(workspace.controller.state.phase).toBe('unknown');
    await workspace.controller.retry();
    expect(workspace.controller.state.phase).toBe('ready');
    expect(workspace.controller.state.data?.allotment).toMatchObject({
      channelId: 'c1',
      roomTypeId: 'rt1',
      range: command.range,
    });
    expect(
      queries.map((url) => [
        url.searchParams.get('channelId'),
        url.searchParams.get('from'),
        url.searchParams.get('to'),
      ]),
    ).toEqual([
      ['c1', command.range.from, command.range.to],
      ['c1', command.range.from, command.range.to],
    ]);
  } finally {
    workspace.dispose();
  }
});
