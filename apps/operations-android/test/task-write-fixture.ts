import type { HousekeepingTask, UserMe } from '@pinehill/contracts';
import { Session } from '../src/session';
import { memoryStorage, type KeyValueStorage } from '../src/storage';
import { TaskWriter } from '../src/housekeeping/writer';
import { taskWritePorts } from '../src/housekeeping/write-ports';
export const ownerId = '00000000-0000-4000-8000-000000000101';
export const propertyId = '00000000-0000-4000-8000-000000000201';
export const task: HousekeepingTask = {
  id: '00000000-0000-4000-8000-000000000301',
  roomId: '00000000-0000-4000-8000-000000000401',
  roomCode: '101',
  businessDate: '2026-11-01',
  status: 'PENDING',
  assignedTo: ownerId,
  note: null,
  completedAt: null,
  version: 3,
};
export function errorResponse(status: number, code: string): Response {
  return Response.json(
    {
      code,
      message: 'Synthetic rejection',
      traceId: 'synthetic',
      timestamp: '2026-11-01T00:00:00Z',
      path: '/api/v1/housekeeping/tasks',
    },
    { status },
  );
}
export async function setup(storage: KeyValueStorage = memoryStorage()) {
  let sequence = 0;
  const s = {
    online: true,
    now: 1793491200000,
    actor: {
      userId: ownerId,
      username: 'synthetic',
      fullName: 'Synthetic',
      role: 'HOUSEKEEPING',
      propertyScope: [propertyId],
      hasPin: true,
      mustChangePassword: false,
    } satisfies UserMe,
    writes: new Array<{
      body: string;
      key: string | null;
      tag: string | null;
      bearer: string | null;
      stored: string | null;
    }>(),
    paths: new Array<string>(),
    rows: [task],
    response: async (): Promise<Response> =>
      Response.json({ ...task, status: 'IN_PROGRESS', version: 4 }, { headers: { etag: '"4"' } }),
  };
  // Mutable role/scopes are an HTTP boundary fixture; Session, transport, decoder and Writer stay real.
  const actor: UserMe = s.actor;
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000001',
    netInfo: { getConnected: async () => s.online },
    fetchImpl: async (input, init) => {
      const path = new URL(String(input)).pathname;
      s.paths.push(path);
      if (path.endsWith('/login'))
        return Response.json({
          tokenType: 'Bearer',
          accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
          expiresInSeconds: 900,
          refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
          refreshExpiresInSeconds: 604800,
        });
      if (path.endsWith('/logout')) return new Response(null, { status: 204 });
      if (path.endsWith('/auth/me')) return Response.json(actor);
      if (init?.method === 'GET')
        return Response.json({
          data: s.rows,
          meta: { limit: 100, total: s.rows.length, hasMore: false, nextCursor: null },
        });
      const headers = new Headers(init?.headers);
      s.writes.push({
        body: String(init?.body),
        key: headers.get('idempotency-key'),
        tag: headers.get('if-match'),
        bearer: headers.get('authorization'),
        stored: await storage.get('housekeeping.pending.' + ownerId),
      });
      return s.response();
    },
  });
  await session.login('synthetic', 'Synthetic-password');
  session.selectProperty(propertyId);
  const deps = {
    ...taskWritePorts(session),
    storage,
    createId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    now: () => s.now,
  };
  const makeWriter = () => new TaskWriter(deps);
  const writer = makeWriter();
  await writer.restore();
  return { s, actor, session, storage, writer, makeWriter };
}
