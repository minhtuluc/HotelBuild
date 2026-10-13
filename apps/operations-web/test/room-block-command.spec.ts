import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { UserMe } from '@pinehill/contracts';
import { AdminController, type AdminPorts } from '../src/app/(ops)/admin-commands/controller';

const block = {
  id: 'b1',
  roomId: 'r1',
  startDate: '2026-11-01',
  endDate: '2026-11-04',
  reason: 'MAINTENANCE' as const,
  note: 'Synthetic repair',
};
const create = {
  kind: 'room-block-create' as const,
  body: {
    roomId: block.roomId,
    startDate: block.startDate,
    endDate: block.endDate,
    reason: block.reason,
    note: block.note,
  },
};
const remove = {
  kind: 'room-block-delete' as const,
  targetId: block.id,
  reason: 'Synthetic repaired',
};

function setup(role: UserMe['role'] = 'MANAGER') {
  const storage = new Map<string, string>(),
    writes: unknown[] = [];
  let failure: unknown;
  const ports: AdminPorts = {
    actor: async () => ({ userId: 'u1', role, propertyScope: ['p1'] }),
    read: async () => ({ properties: [], roomTypes: [], rooms: [], blocks: [block] }),
    write: async (command, key) => {
      writes.push({ command, key, persisted: storage.size });
      if (failure) throw failure;
      return command.kind === 'room-block-delete'
        ? { kind: 'room-block-delete', id: command.targetId }
        : { kind: 'room-block-create', data: block };
    },
  };
  const options = {
    scope: 'room-block' as const,
    ports,
    storage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
    createId: () => 'babc0000-0000-4000-8000-000000000001',
    now: () => 1000,
  };
  return {
    c: new AdminController(options),
    ports,
    options,
    writes,
    storage,
    fail: (value: unknown) => {
      failure = value;
    },
  };
}

test('authoritative FRONT_DESK create affordance never allows removal', async () => {
  const s = setup('FRONT_DESK');
  await s.c.load();
  expect(s.c.state.canWrite).toBe(true);
  expect(s.c.state.canRemove).toBe(false);
  await s.c.save(create);
  expect(s.writes).toHaveLength(1);
  expect(s.writes[0]).toMatchObject({ command: { kind: 'room-block-create' }, persisted: 1 });
  await s.c.save(remove);
  expect(s.writes).toHaveLength(1);
});
test('HOUSEKEEPING reads without create/delete commands', async () => {
  const s = setup('HOUSEKEEPING');
  await s.c.load();
  expect(s.c.state.data?.blocks).toEqual([block]);
  expect(s.c.state.canWrite).toBe(false);
  await s.c.save(create);
  await s.c.save(remove);
  expect(s.writes).toEqual([]);
});
for (const command of [create, remove]) {
  test(`${command.kind}: lost response survives reload; matching GET never settles own command`, async () => {
    const s = setup();
    await s.c.load();
    s.fail(Error('response lost'));
    await s.c.save(command);
    expect(s.c.state.phase).toBe('unknown');
    const restored = new AdminController(s.options);
    await restored.load();
    expect(restored.state.phase).toBe('unknown');
    await restored.save(command);
    expect(s.writes).toHaveLength(1);
    s.fail(undefined);
    if (command.kind === 'room-block-delete')
      s.ports.read = async () => ({ properties: [], roomTypes: [], rooms: [], blocks: [] });
    await restored.retry();
    expect(s.writes).toHaveLength(2);
    expect(s.writes[1]).toEqual(s.writes[0]);
    expect(restored.state.receipt?.kind).toBe(command.kind);
    expect(s.storage.size).toBe(0);
  });
  test(`${command.kind}: acknowledged result remains known if GET fails`, async () => {
    const s = setup();
    await s.c.load();
    s.ports.read = async () => {
      throw Error('read failed');
    };
    await s.c.save(command);
    expect(s.c.state.receipt?.kind).toBe(command.kind);
    expect(s.c.state.referenceId).toBeNull();
    expect(s.storage.size).toBe(0);
  });
}
test('stale read cannot display a removed row as though the delete failed', async () => {
  const s = setup();
  await s.c.load();
  await s.c.save(remove);
  expect(s.c.state.receipt).toEqual({ kind: 'room-block-delete', id: block.id });
  expect(s.c.state.phase).toBe('error');
  expect(s.c.state.data).toBeNull();
});
test('400 keeps validation details and permits corrected input with a fresh key', async () => {
  const s = setup();
  await s.c.load();
  s.fail(
    new ApiError({
      kind: 'http',
      status: 400,
      message: 'invalid',
      details: [{ field: 'endDate', issue: 'INVALID' }],
    }),
  );
  await s.c.save(create);
  expect(s.c.state.phase).toBe('validation');
  expect(s.c.state.issues).toEqual([{ field: 'endDate', issue: 'INVALID' }]);
  expect(s.storage.size).toBe(0);
  expect(s.c.canStart()).toBe(true);
});
test('prewrite MANAGER downgrade or property scope change cannot send captured delete', async () => {
  for (const changed of [
    { role: 'FRONT_DESK' as const, propertyScope: ['p1'] },
    { role: 'MANAGER' as const, propertyScope: ['p2'] },
  ]) {
    const s = setup();
    await s.c.load();
    s.ports.actor = async () => ({ userId: 'u1', ...changed });
    await s.c.save(remove);
    expect(s.writes).toEqual([]);
    expect(s.storage.size).toBe(0);
    expect(s.c.state.data).toBeNull();
  }
});

test('scope changes during catalogue reads discard captured private rows before publication', async () => {
  const s = setup();
  let scope = ['p1'];
  s.ports.actor = async () => ({ userId: 'u1', role: 'MANAGER', propertyScope: scope });
  s.ports.read = async () => {
    scope = ['p2'];
    return { properties: [], roomTypes: [], rooms: [], blocks: [block] };
  };
  await s.c.load();
  expect(s.c.state.data).toBeNull();
  expect(s.c.state.actorRevision).toBe(1);
  expect(s.c.state.error).toMatchObject({ kind: 'aborted' });
});

test('a confirmed create can be removed concurrently; current empty GET preserves acknowledgement without resurrecting it', async () => {
  const s = setup();
  await s.c.load();
  s.ports.read = async () => ({ properties: [], roomTypes: [], rooms: [], blocks: [] });
  await s.c.save(create);
  expect(s.c.state.receipt?.kind).toBe('room-block-create');
  expect(s.c.state.phase).toBe('ready');
  expect(s.c.state.data?.blocks).toEqual([]);
});
test('a known DELETE with stale readback hides the whole old catalogue, rather than retaining a partial graph', async () => {
  const s = setup();
  await s.c.load();
  await s.c.save(remove);
  expect(s.c.state.receipt?.kind).toBe('room-block-delete');
  expect(s.c.state.data).toBeNull();
});
