import { expect, test } from 'vitest';
import { AdminController, type AdminPorts } from '../src/app/(ops)/admin-commands/controller';
import { ApiError } from '@pinehill/api-client';
const source = {
  id: 'r1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code: 'CS01-101',
  floor: 1,
  status: 'ACTIVE' as const,
  connectingRoomId: null,
  version: 1789876543123456,
};
const target = { ...source, id: 'r2', code: 'CS01-102', version: 1789876543123457 };
const command = {
  kind: 'connecting-update' as const,
  targetId: 'r1',
  tag: '"1789876543123456"',
  body: { connectingRoomId: 'r2' },
};
function setup(role: 'MANAGER' | 'OWNER' | 'FRONT_DESK' = 'MANAGER') {
  const storage = new Map<string, string>();
  const writes: unknown[] = [];
  let fail: unknown;
  const ports: AdminPorts = {
    actor: async () => ({ userId: 'manager1', role }),
    read: async () => ({ properties: [], roomTypes: [], rooms: [source, target] }),
    write: async (cmd, id) => {
      writes.push({ cmd, id, persisted: storage.size });
      if (fail) throw fail;
      return {
        kind: 'connecting-update',
        data: { ...source, connectingRoomId: 'r2', version: 1789876543123460 },
      };
    },
  };
  const options = {
    scope: 'connecting' as const,
    ports,
    storage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    },
    createId: () => 'babc0000-0000-4000-8000-000000000001',
    now: () => 1000,
  };
  const c = new AdminController(options);
  return {
    c,
    ports,
    storage,
    writes,
    options,
    fail: (e: unknown) => {
      fail = e;
    },
  };
}
test('current MANAGER may configure connection, while FRONT_DESK remains readonly', async () => {
  const s = setup();
  await s.c.load();
  expect(s.c.state.canWrite).toBe(true);
  await s.c.save(command);
  expect(s.writes).toHaveLength(1);
  expect(s.writes[0]).toMatchObject({ cmd: command, persisted: 1 });
  const read = setup('FRONT_DESK');
  await read.c.load();
  expect(read.c.state.canWrite).toBe(false);
  await read.c.save(command);
  expect(read.writes).toHaveLength(0);
});
test('acknowledged connection never fabricates reciprocal row when authoritative readback fails', async () => {
  const s = setup('OWNER');
  await s.c.load();
  s.ports.read = async () => {
    throw Error('readback');
  };
  await s.c.save(command);
  expect(s.c.state.receipt?.kind).toBe('connecting-update');
  expect(s.c.state.data).toBeNull();
  expect(s.c.state.referenceId).toBeNull();
});
test('lost response reloaded connection preserves exact microsecond tag/body/key and manual replay', async () => {
  const s = setup();
  await s.c.load();
  s.fail(Error('lost'));
  await s.c.save(command);
  const restored = new AdminController(s.options);
  await restored.load();
  expect(restored.state.phase).toBe('unknown');
  await restored.save(command);
  expect(s.writes).toHaveLength(1);
  s.fail(undefined);
  await restored.retry();
  expect(s.writes).toHaveLength(2);
  expect(s.writes[1]).toEqual(s.writes[0]);
});
test('stale source graph after connection acknowledgement is not shown as updated', async () => {
  const s = setup('OWNER');
  await s.c.load();
  await s.c.save(command);
  expect(s.c.state.receipt?.kind).toBe('connecting-update');
  expect(s.c.state.data).toBeNull();
  expect(s.c.state.phase).toBe('error');
});
test('connection412 uses existing comparison fence before issuing new tag', async () => {
  const s = setup();
  await s.c.load();
  s.fail(new ApiError({ kind: 'http', status: 412, message: 'conflict' }));
  await s.c.save(command);
  expect(s.c.state.phase).toBe('conflict');
  await s.c.load();
  await s.c.save(command);
  expect(s.writes).toHaveLength(1);
});
