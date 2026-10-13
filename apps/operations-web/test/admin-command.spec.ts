import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { AdminController, type AdminPorts } from '../src/app/(ops)/admin-commands/controller';
import type { AdminCommand } from '../src/app/(ops)/admin-commands/intent';
const command: AdminCommand = {
  kind: 'property-update',
  targetId: 'p1',
  tag: '"3"',
  body: { name: 'Changed', reason: 'synthetic reason' },
};
const property = {
  id: 'p1',
  name: 'Synthetic',
  status: 'ACTIVE' as const,
  activeRoomCount: 2,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 3,
};
function setup() {
  let owner: { userId: string; role: 'OWNER' | 'MANAGER' } = { userId: 'owner1', role: 'OWNER' };
  let now = 1000,
    fail: unknown;
  const stored = new Map<string, string>();
  const writes: { command: AdminCommand; id: string; persisted: boolean }[] = [];
  let sequence = 0;
  const ports: AdminPorts = {
    actor: async () => owner,
    read: async () => ({ properties: [property], roomTypes: [] }),
    write: async (cmd, id) => {
      writes.push({ command: cmd, id, persisted: stored.size === 1 });
      if (fail) throw fail;
      return { kind: 'property-update', data: { ...property, name: 'Changed', version: 4 } };
    },
  };
  const options = {
    ports,
    scope: 'property' as const,
    storage: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => {
        stored.set(k, v);
      },
      removeItem: (k: string) => {
        stored.delete(k);
      },
    },
    createId: () => '7ed2bdb1-c3e0-467f-89e0-' + (++sequence).toString().padStart(12, '0'),
    now: () => now,
  };
  const c = new AdminController(options);
  return {
    c,
    ports,
    options,
    stored,
    writes,
    fail: (e: unknown) => {
      fail = e;
    },
    owner: (userId: string, role: 'OWNER' | 'MANAGER') => {
      owner = { userId, role };
    },
    advance: () => {
      now += 86400000;
    },
  };
}
test('current MANAGER reads allowed catalogue but cannot write or expose OWNER editor affordance', async () => {
  const s = setup();
  s.owner('owner1', 'MANAGER');
  await s.c.load();
  expect(s.c.state.data?.properties).toHaveLength(1);
  expect(s.c.state.canWrite).toBe(false);
  await s.c.save(command);
  expect(s.writes).toHaveLength(0);
});
test('OWNER persists validated command before one write and retains typed acknowledged receipt', async () => {
  const s = setup();
  await s.c.load();
  await s.c.save(command);
  expect(s.writes).toHaveLength(1);
  expect(s.writes[0]).toMatchObject({ command, persisted: true });
  expect(s.c.state.receipt).toMatchObject({ kind: 'property-update', data: { version: 4 } });
  expect(s.stored.size).toBe(0);
});
test('lost response/reload remains unknown and manual replay uses same command/key even after readmatches', async () => {
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
test('past24h never retries old key or admits fresh command while result unresolved', async () => {
  const s = setup();
  await s.c.load();
  s.fail(Error('lost'));
  await s.c.save(command);
  s.advance();
  await s.c.retry();
  await s.c.load();
  await s.c.save(command);
  expect(s.writes).toHaveLength(1);
  expect(s.c.state.phase).toBe('unknown');
});
test('412 requires successful fresh read and explicit comparison before new version/key', async () => {
  const s = setup();
  await s.c.load();
  s.fail(new ApiError({ kind: 'http', status: 412, message: 'conflict' }));
  await s.c.save(command);
  expect(s.c.state.phase).toBe('conflict');
  s.fail(undefined);
  await s.c.load();
  await s.c.save({ ...command, tag: '"4"' });
  expect(s.writes).toHaveLength(1);
  s.c.adoptVersion();
  await s.c.save({ ...command, tag: '"4"' });
  expect(s.writes).toHaveLength(2);
  expect(s.writes[1]?.id).not.toBe(s.writes[0]?.id);
});
test('failed conflict reload never bypasses compare fence', async () => {
  const s = setup();
  await s.c.load();
  s.fail(new ApiError({ kind: 'http', status: 412, message: 'conflict' }));
  await s.c.save(command);
  s.fail(undefined);
  s.ports.read = async () => {
    throw Error('read');
  };
  await s.c.load();
  s.c.adoptVersion();
  await s.c.save(command);
  expect(s.writes).toHaveLength(1);
});
test('different actor before write clears cache and never applies previous actor command', async () => {
  const s = setup();
  await s.c.load();
  s.owner('owner2', 'OWNER');
  await s.c.save(command);
  expect(s.writes).toHaveLength(0);
  expect(s.c.state.data).toBeNull();
  expect(s.c.state.phase).toBe('forbidden');
});
test('storage failure blocks untrackable command', async () => {
  const s = setup();
  s.options.storage.setItem = () => {
    throw Error('storage');
  };
  await s.c.load();
  await s.c.save(command);
  expect(s.writes).toHaveLength(0);
});
test('role revoked before write clears data, late completion cannot republish after logout', async () => {
  const s = setup();
  await s.c.load();
  s.owner('owner1', 'MANAGER');
  await s.c.save(command);
  expect(s.writes).toHaveLength(0);
  expect(s.c.state.data).toBeNull();
});
test('acknowledged result survives later GET failure and pending lock clears', async () => {
  const s = setup();
  await s.c.load();
  s.ports.read = async () => {
    throw Error('read');
  };
  await s.c.save(command);
  expect(s.c.state.receipt).not.toBeNull();
  expect(s.c.state.referenceId).toBeNull();
  expect(s.writes).toHaveLength(1);
});
test('stale GET after acknowledged write cannot overwrite the newer receipt projection', async () => {
  const s = setup();
  await s.c.load();
  await s.c.save(command);
  expect(s.c.state.data?.properties[0]?.version).toBe(4);
  expect(s.c.state.data?.properties[0]?.name).toBe('Changed');
  expect(s.c.state.receipt).not.toBeNull();
});
test('role downgrade on read clears previous OWNER cache/receipt before accepting new scope', async () => {
  const s = setup();
  await s.c.load();
  await s.c.save(command);
  s.owner('owner1', 'MANAGER');
  s.ports.read = async () => ({ properties: [], roomTypes: [] });
  await s.c.load();
  expect(s.c.state.data?.properties).toEqual([]);
  expect(s.c.state.receipt).toBeNull();
  expect(s.c.state.canWrite).toBe(false);
});

test('busy write fences double click and late success after denial cannot republish receipt or rows', async () => {
  const s = setup();
  await s.c.load();
  let resolve: ((value: Awaited<ReturnType<AdminPorts['write']>>) => void) | undefined;
  s.ports.write = async (cmd, id) => {
    s.writes.push({ command: cmd, id, persisted: true });
    return new Promise((r) => {
      resolve = r;
    });
  };
  const first = s.c.save(command);
  await new Promise((r) => setTimeout(r, 0));
  await s.c.save(command);
  expect(s.writes).toHaveLength(1);
  s.c.deny('expired');
  resolve?.({ kind: 'property-update', data: { ...property, version: 4 } });
  await first;
  expect(s.c.state.phase).toBe('expired');
  expect(s.c.state.data).toBeNull();
  expect(s.c.state.receipt).toBeNull();
  expect(s.stored.size).toBe(1);
});
test('corrupt persisted intent never admits fresh command or manual retry', async () => {
  const s = setup();
  s.stored.set('pinehill-admin:property:owner1', 'broken');
  await s.c.load();
  expect(s.c.state.phase).toBe('unknown');
  await s.c.save(command);
  await s.c.retry();
  expect(s.writes).toHaveLength(0);
});
test('read-only 403 after known catalogue clears every receipt/cache', async () => {
  const s = setup();
  await s.c.load();
  s.ports.read = async () => {
    throw new ApiError({ kind: 'http', status: 403, message: 'denied' });
  };
  await s.c.load();
  expect(s.c.state.data).toBeNull();
  expect(s.c.state.receipt).toBeNull();
  expect(s.c.state.phase).toBe('forbidden');
});
test('disposed controller ignores pending read and cannot mutate', async () => {
  const s = setup();
  let resolve: ((value: Awaited<ReturnType<AdminPorts['read']>>) => void) | undefined;
  s.ports.read = async () =>
    new Promise((r) => {
      resolve = r;
    });
  const load = s.c.load();
  await new Promise((r) => setTimeout(r, 0));
  s.c.dispose();
  resolve?.({ properties: [property], roomTypes: [] });
  await load;
  expect(s.c.state.data).toBeNull();
  await s.c.save(command);
  expect(s.writes).toHaveLength(0);
});
