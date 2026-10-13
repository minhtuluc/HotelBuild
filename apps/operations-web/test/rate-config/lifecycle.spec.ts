import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { AdminController } from '../../src/app/(ops)/admin-commands/controller';
import { intentStorageKey } from '../../src/app/(ops)/admin-commands/intent';
import { actor, data, command } from './fixture';
function setup() {
  const entries = new Map<string, string>(),
    writes: unknown[] = [];
  let now = 1000,
    unknown = true,
    readFails = false;
  const ports = {
    actor: async () => actor,
    read: async () => {
      if (readFails) throw Error('Synthetic read failure');
      return { ...data, ratePlans: [{ ...data.ratePlans[0]!, version: 2 }] };
    },
    write: async (cmd: unknown, key: string) => {
      writes.push({ cmd, key });
      if (unknown) throw new ApiError({ kind: 'network', message: 'Synthetic lost response' });
      return { kind: 'rate-plan-put' as const, id: data.ratePlans[0]!.id, priorVersion: 1 };
    },
  };
  const options = {
    scope: 'rate-config' as const,
    ports,
    storage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    },
    createId: () => '00000000-0000-4000-8000-000000000010',
    now: () => now,
  };
  return {
    options,
    controller: new AdminController(options),
    writes,
    entries,
    time: (value: number) => {
      now = value;
    },
    unknown: (value: boolean) => {
      unknown = value;
    },
    failRead: () => {
      readFails = true;
    },
  };
}
test('unknown outcome remains unknown after equal read/reload and replays exact durable command', async () => {
  const s = setup();
  await s.controller.load();
  await s.controller.save(command);
  expect(s.controller.state.phase).toBe('unknown');
  const raw = s.entries.get(intentStorageKey(actor.userId, 'rate-config'));
  expect(raw).toBeDefined();
  await s.controller.load();
  expect(s.controller.state.phase).toBe('unknown');
  expect(s.writes).toHaveLength(1);
  s.controller.dispose();
  const resumed = new AdminController(s.options);
  try {
    await resumed.load();
    expect(resumed.state.phase).toBe('unknown');
    s.unknown(false);
    await resumed.retry();
    expect(s.writes).toHaveLength(2);
    expect(s.writes[1]).toEqual(s.writes[0]);
    expect(resumed.state.receipt?.kind).toBe('rate-plan-put');
    expect(s.entries.size).toBe(0);
  } finally {
    resumed.dispose();
  }
});
test('expired intent never retries with a new key and read failure cannot open an editor', async () => {
  const s = setup();
  await s.controller.load();
  await s.controller.save(command);
  s.time(86401000);
  expect(s.controller.canRetry()).toBe(false);
  await s.controller.retry();
  expect(s.writes).toHaveLength(1);
  s.controller.dispose();
  const next = setup();
  await next.controller.load();
  expect(next.controller.canStart()).toBe(true);
  next.failRead();
  await next.controller.load();
  expect(next.controller.state.data).toBeNull();
  expect(next.controller.canStart()).toBe(false);
  next.controller.dispose();
});
