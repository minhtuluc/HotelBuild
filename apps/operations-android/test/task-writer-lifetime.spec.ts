import { expect, test } from 'vitest';
import { setup, task, ownerId, propertyId } from './task-write-fixture';
import { memoryStorage } from '../src/storage';
const slot = 'housekeeping.pending.' + ownerId;
const otherProperty = '00000000-0000-4000-8000-000000000202';
test('changing session selection during durable save prevents the delayed mutation', async () => {
  const storage = memoryStorage(),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const t = await setup({
    ...storage,
    set: async (key, value) => {
      await storage.set(key, value);
      entered.resolve();
      await release.promise;
    },
  });
  let request: Promise<void> | undefined;
  try {
    t.actor.propertyScope.push(otherProperty);
    // Bind the current role/scope snapshot before starting the persistence race.
    t.writer.invalidate();
    await t.writer.restore();
    request = t.writer.start(task, 'IN_PROGRESS');
    await entered.promise;
    t.session.selectProperty(otherProperty);
    release.resolve();
    await request;
    expect(t.s.writes).toHaveLength(0);
    expect(t.writer.state.phase).toBe('idle');
    expect(t.writer.canStart).toBe(false);
    expect(await storage.get(slot)).not.toBeNull();
  } finally {
    release.resolve();
    await request;
    t.writer.dispose();
  }
});
test('logout during PATCH suppresses late acknowledgement and retains owner-bound pending request', async () => {
  const t = await setup(),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let request: Promise<void> | undefined;
  try {
    t.s.response = async () => {
      entered.resolve();
      await release.promise;
      return Response.json(
        { ...task, status: 'IN_PROGRESS', version: 4 },
        { headers: { etag: '"4"' } },
      );
    };
    request = t.writer.start(task, 'IN_PROGRESS');
    await entered.promise;
    await t.session.logout();
    release.resolve();
    await request;
    expect(t.writer.state.phase).toBe('idle');
    expect(t.writer.canRetry).toBe(false);
    expect(await t.storage.get(slot)).not.toBeNull();
    expect(t.s.writes).toHaveLength(1);
    expect(t.s.paths.some((p) => p.endsWith('/refresh'))).toBe(false);
  } finally {
    release.resolve();
    await request;
    t.writer.dispose();
  }
});
test('session invalidation triggered by a sending listener prevents even the first PATCH', async () => {
  const t = await setup();
  t.actor.propertyScope.push(otherProperty);
  t.writer.invalidate();
  await t.writer.restore();
  const stop = t.writer.subscribe(() => {
    if (t.writer.state.phase === 'sending') t.session.selectProperty(otherProperty);
  });
  try {
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.s.writes).toHaveLength(0);
    expect(t.writer.state.phase).toBe('idle');
    expect(await t.storage.get(slot)).not.toBeNull();
  } finally {
    stop();
    t.writer.dispose();
  }
});
test.each(['role', 'scope', 'principal'])(
  'server %s changes fail preflight without PATCH',
  async (kind) => {
    const t = await setup();
    try {
      if (kind === 'role') t.actor.role = 'FRONT_DESK';
      if (kind === 'scope') t.actor.propertyScope = [];
      if (kind === 'principal') t.actor.userId = '00000000-0000-4000-8000-000000000102';
      await t.writer.start(task, 'IN_PROGRESS');
      expect(t.s.writes).toHaveLength(0);
      expect(t.writer.state.phase).toBe('forbidden');
      expect(await t.storage.get(slot)).toBeNull();
    } finally {
      t.writer.dispose();
    }
  },
);
test('context-mismatched durable records are never replayed or replaced', async () => {
  const t = await setup();
  try {
    t.s.response = async () => {
      throw Error('synthetic');
    };
    await t.writer.start(task, 'IN_PROGRESS');
    const pending = await t.storage.get(slot);
    t.actor.propertyScope.push(otherProperty);
    t.session.selectProperty(otherProperty);
    await t.writer.restore();
    await t.writer.retry();
    await t.writer.start(task, 'DONE');
    expect(t.writer.state.phase).toBe('forbidden');
    expect(t.s.writes).toHaveLength(1);
    expect(await t.storage.get(slot)).toBe(pending);
    t.session.selectProperty(propertyId);
    t.actor.propertyScope.pop();
    await t.writer.restore();
    expect(t.writer.state.phase).toBe('unknown');
    expect(t.s.writes).toHaveLength(1);
  } finally {
    t.writer.dispose();
  }
});
test('dispose after durable save prevents any delayed transport and publishing', async () => {
  const storage = memoryStorage(),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const t = await setup({
    ...storage,
    set: async (key, value) => {
      await storage.set(key, value);
      entered.resolve();
      await release.promise;
    },
  });
  let request: Promise<void> | undefined;
  try {
    request = t.writer.start(task, 'IN_PROGRESS');
    await entered.promise;
    t.writer.dispose();
    release.resolve();
    await request;
    expect(t.s.writes).toHaveLength(0);
    expect(await storage.get(slot)).not.toBeNull();
  } finally {
    release.resolve();
    await request;
    t.writer.dispose();
  }
});
