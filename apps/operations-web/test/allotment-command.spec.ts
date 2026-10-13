import type { AdminCommand } from '../src/app/(ops)/admin-commands/intent';
import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { AdminController, type AdminPorts } from '../src/app/(ops)/admin-commands/controller';
const command: Extract<AdminCommand, { kind: 'allotment-put' }> = {
  kind: 'allotment-put',
  tag: '"9007199254740993"',
  range: { from: '2026-11-01', to: '2026-11-03' },
  body: { channelId: 'c1', roomTypeId: 'rt1', items: [{ date: '2026-11-01', allotment: 1 }] },
};
function setup() {
  let failure: unknown,
    tag = command.tag.toString();
  const stored = new Map<string, string>(),
    writes: { command: unknown; key: string; persisted: boolean }[] = [];
  const reads: unknown[] = [];
  const ports: AdminPorts = {
    actor: async () => ({ userId: 'manager1', role: 'MANAGER', propertyScope: ['p1'] }),
    read: async (_signal, intent) => {
      reads.push(intent);
      return {
        properties: [],
        roomTypes: [],
        channels: [],
        allotment: {
          propertyId: 'p1',
          channelId: 'c1',
          roomTypeId: 'rt1',
          range: command.range,
          rows: [],
          tag,
        },
      };
    },
    write: async (cmd, key) => {
      writes.push({ command: cmd, key, persisted: stored.size === 1 });
      if (failure) throw failure;
      tag = '"9007199254740994"';
      return { kind: 'allotment-put', channelId: 'c1', roomTypeId: 'rt1', tag };
    },
  };
  const options = {
    scope: 'allotment' as const,
    ports,
    storage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
      removeItem: (key: string) => {
        stored.delete(key);
      },
    },
    createId: () => '7ed2bdb1-c3e0-467f-89e0-' + String(writes.length + 1).padStart(12, '0'),
    now: () => 1000,
  };
  return {
    c: new AdminController(options),
    options,
    ports,
    writes,
    reads,
    stored,
    fail: (value: unknown) => {
      failure = value;
    },
  };
}
test('MANAGER persists one exact batch with large ETag and receives typed204 acknowledgment', async () => {
  const s = setup();
  await s.c.load();
  expect(s.c.canStart()).toBe(true);
  await s.c.save(command);
  expect(s.writes).toEqual([
    { command, key: '7ed2bdb1-c3e0-467f-89e0-000000000001', persisted: true },
  ]);
  expect(s.c.state.receipt).toMatchObject({ kind: 'allotment-put', tag: '"9007199254740994"' });
  expect(s.stored.size).toBe(0);
});
test('lost batch reload uses durable pair/range and manual replay retains exactUUID/body/tag', async () => {
  const s = setup();
  await s.c.load();
  s.fail(Error('lost'));
  await s.c.save(command);
  expect(s.c.state.phase).toBe('unknown');
  const restored = new AdminController(s.options);
  await restored.load();
  expect(s.reads.at(-1)).toEqual(command);
  expect(restored.state.phase).toBe('unknown');
  await restored.save(command);
  expect(s.writes).toHaveLength(1);
  s.fail(undefined);
  await restored.retry();
  expect(s.writes[1]).toEqual(s.writes[0]);
  expect(restored.state.phase).toBe('ready');
});
test('documented quota409 keeps command editable; generic409 retains unknown intent', async () => {
  const s = setup();
  await s.c.load();
  s.fail(
    new ApiError({
      kind: 'http',
      status: 409,
      code: 'E_INV_ALLOTMENT_EXCEEDS_ROOMS',
      message: 'Synthetic validation',
      details: [{ field: 'items[2026-11-01].allotment', issue: 'EXCEEDS_ACTIVE_SUPPLY' }],
    }),
  );
  await s.c.save(command);
  expect(s.c.state.phase).toBe('validation');
  expect(s.c.state.issues).toEqual([
    { field: 'items[2026-11-01].allotment', issue: 'EXCEEDS_ACTIVE_SUPPLY' },
  ]);
  expect(s.c.canStart()).toBe(true);
  expect(s.stored.size).toBe(0);
  s.fail(
    new ApiError({
      kind: 'http',
      status: 409,
      code: 'E_IDEM_CONCURRENT_REQUEST',
      message: 'Synthetic concurrent',
    }),
  );
  await s.c.save(command);
  expect(s.c.state.phase).toBe('unknown');
  expect(s.stored.size).toBe(1);
});
test('412 retains comparison fence before explicit adoption of current exact string tag', async () => {
  const s = setup();
  await s.c.load();
  s.fail(new ApiError({ kind: 'http', status: 412, message: 'Synthetic conflict' }));
  await s.c.save(command);
  expect(s.c.state.phase).toBe('conflict');
  await s.c.load();
  await s.c.save(command);
  expect(s.writes).toHaveLength(1);
  s.c.adoptVersion();
  s.fail(undefined);
  await s.c.save(command);
  expect(s.writes).toHaveLength(2);
});
test('acknowledged batch hides old rows when readback fails', async () => {
  const s = setup();
  await s.c.load();
  s.ports.read = async () => {
    throw Error('Synthetic read unavailable');
  };
  await s.c.save(command);
  expect(s.c.state.receipt?.kind).toBe('allotment-put');
  expect(s.c.state.data).toBeNull();
  expect(s.c.state.phase).toBe('error');
});

test('new command cannot target a pair/tag different from its visible authoritative selection', async () => {
  const s = setup();
  await s.c.load();
  await s.c.save({ ...command, body: { ...command.body, channelId: 'other' } });
  expect(s.writes).toHaveLength(0);
  expect(s.stored.size).toBe(0);
});
test('selection reset clears private rows/tag immediately and cannot retarget unresolved intent', async () => {
  const s = setup();
  await s.c.load();
  expect(s.c.resetRead()).toBe(true);
  expect(s.c.state.data).toBeNull();
  expect(s.c.canStart()).toBe(false);
  await s.c.load();
  s.fail(Error('lost'));
  await s.c.save(command);
  expect(s.c.resetRead()).toBe(false);
  expect(s.c.state.phase).toBe('unknown');
});

test('verified empty authorized pair keeps selection available but cannot issue a quota command', async () => {
  const s = setup();
  s.ports.read = async () => ({
    properties: [],
    roomTypes: [],
    channels: [],
    allotmentSelection: { propertyId: 'empty', range: command.range },
  });
  await s.c.load();
  expect(s.c.state.phase).toBe('ready');
  expect(s.c.canStart()).toBe(false);
  expect(s.c.resetRead()).toBe(true);
});
