import { expect, test } from 'vitest';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';
import { TaskReader } from '../src/housekeeping/reader';
import { taskPorts } from '../src/housekeeping/ports';
const actor = {
  userId: 'u1',
  username: 'synthetic',
  fullName: 'Synthetic',
  role: 'HOUSEKEEPING',
  propertyScope: ['p1'],
  hasPin: true,
  mustChangePassword: false,
};
const task = {
  id: 't1',
  roomId: 'r1',
  roomCode: '101',
  businessDate: '2026-11-01',
  status: 'PENDING',
  assignedTo: 'u1',
  note: null,
  completedAt: null,
  version: 1,
};
const tokens = {
  tokenType: 'Bearer',
  accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604800,
};
function setup(extra = false) {
  const paths: string[] = [];
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    netInfo: { getConnected: async () => true },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      paths.push(url.href);
      if (url.pathname.endsWith('/login')) return Response.json(tokens);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + tokens.accessToken);
      if (url.pathname.endsWith('/auth/me')) return Response.json(actor);
      expect(url.searchParams.get('assignedTo')).toBe('u1');
      expect(url.searchParams.get('propertyId')).toBe('p1');
      return Response.json({
        data: [extra ? { ...task, guestName: 'SYNTHETIC_PRIVATE_GUEST' } : task],
        meta: { limit: 100, total: 1, hasMore: false, nextCursor: null },
      });
    },
  });
  return { session, paths };
}
test('actual Session/client composition carries current bearer/query and publishes only task DTO', async () => {
  const s = setup();
  await s.session.login('synthetic', 'Synthetic-password');
  const reader = new TaskReader(taskPorts(s.session));
  try {
    await reader.load(task.businessDate, 'p1');
    expect(reader.state.phase).toBe('ready');
    expect(reader.state.tasks).toEqual([task]);
    expect(s.paths.filter((path) => path.includes('/housekeeping/tasks'))).toHaveLength(1);
    expect(s.paths.filter((path) => path.includes('/auth/me'))).toHaveLength(2);
  } finally {
    reader.dispose();
  }
});
test('extra guest/booking fields in upstream task DTO are never cached or shown', async () => {
  const s = setup(true);
  await s.session.login('synthetic', 'Synthetic-password');
  const reader = new TaskReader(taskPorts(s.session));
  try {
    await reader.load(task.businessDate, 'p1');
    expect(reader.state.phase).toBe('error');
    expect(reader.state.tasks).toEqual([]);
    expect(JSON.stringify(reader.state)).not.toContain('SYNTHETIC_PRIVATE_GUEST');
  } finally {
    reader.dispose();
  }
});
