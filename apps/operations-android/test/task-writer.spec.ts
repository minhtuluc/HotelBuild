import { expect, test } from 'vitest';
import { memoryStorage } from '../src/storage';
import { setup, task, ownerId, errorResponse } from './task-write-fixture';
const slot = 'housekeeping.pending.' + ownerId;
test('persisted intent precedes real transport, carries exact headers/body, and clears only after ack', async () => {
  const t = await setup();
  try {
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.writer.state.phase).toBe('saved');
    expect(t.s.writes).toHaveLength(1);
    expect(t.s.writes[0]).toMatchObject({
      body: '{"status":"IN_PROGRESS"}',
      key: '00000000-0000-4000-8000-000000000001',
      tag: '"3"',
      bearer: 'Bearer synthetic-access-aaaaaaaaaaaaaaaaaaaa',
    });
    const raw = t.s.writes[0]!.stored;
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({ taskId: task.id, version: 3, target: 'IN_PROGRESS' });
    expect(raw).not.toMatch(/Token|pin|guest|roomCode|note/);
    expect(await t.storage.get(slot)).toBeNull();
    expect(t.writer.canStart).toBe(true);
  } finally {
    t.writer.dispose();
  }
});
test('save failure sends no PATCH and retries the same intent after storage recovers', async () => {
  const storage = memoryStorage();
  let broken = true;
  const t = await setup({
    ...storage,
    set: async (key, value) => {
      if (broken) throw Error('synthetic');
      await storage.set(key, value);
    },
  });
  try {
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.writer.state.phase).toBe('storageError');
    expect(t.s.writes).toHaveLength(0);
    broken = false;
    await t.writer.retry();
    expect(t.writer.state.phase).toBe('saved');
    expect(t.s.writes[0]!.key).toBe('00000000-0000-4000-8000-000000000001');
  } finally {
    t.writer.dispose();
  }
});
test('lost response survives remount without auto-send; manual replay keeps bytes/key/version', async () => {
  const t = await setup();
  let second = t.writer;
  try {
    t.s.response = async () => {
      throw Error('synthetic lost response after commit');
    };
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.writer.state.phase).toBe('unknown');
    t.writer.dispose();
    second = t.makeWriter();
    await second.restore();
    expect(second.state.phase).toBe('unknown');
    expect(t.s.writes).toHaveLength(1);
    t.s.response = async () =>
      Response.json(
        { ...task, status: 'IN_PROGRESS', version: 4 },
        { headers: { etag: '"4"', 'idempotency-replayed': 'true' } },
      );
    await second.retry();
    expect(second.state.phase).toBe('saved');
    expect(t.s.writes).toHaveLength(2);
    expect(t.s.writes[1]).toEqual(t.s.writes[0]);
  } finally {
    second.dispose();
    t.writer.dispose();
  }
});
test('new intentions cannot replace unresolved ones even through another mounted writer', async () => {
  const t = await setup(),
    other = t.makeWriter();
  try {
    await other.restore();
    t.s.response = async () => {
      throw Error('synthetic');
    };
    await t.writer.start(task, 'IN_PROGRESS');
    const pending = await t.storage.get(slot);
    await other.start(task, 'DONE');
    expect(t.s.writes).toHaveLength(1);
    expect(await t.storage.get(slot)).toBe(pending);
    expect(other.canStart).toBe(false);
  } finally {
    t.writer.dispose();
    other.dispose();
  }
});
test.each([24 * 3600000, 24 * 3600000 + 1, -1])(
  'age %s cannot replay or erase unknown intent',
  async (age) => {
    const t = await setup();
    try {
      t.s.response = async () => {
        throw Error('synthetic');
      };
      await t.writer.start(task, 'IN_PROGRESS');
      const pending = await t.storage.get(slot);
      t.s.now += age;
      await t.writer.retry();
      expect(t.writer.state.phase).toBe('needsReview');
      expect(t.s.writes).toHaveLength(1);
      expect(await t.storage.get(slot)).toBe(pending);
    } finally {
      t.writer.dispose();
    }
  },
);
test.each(['{bad', '{"taskId":"arbitrary"}'])(
  'malformed stored intent cannot be overwritten: %s',
  async (raw) => {
    const t = await setup();
    try {
      await t.storage.set(slot, raw);
      await t.writer.restore();
      await t.writer.start(task, 'DONE');
      await t.writer.retry();
      expect(t.writer.state.phase).toBe('needsReview');
      expect(t.s.writes).toHaveLength(0);
      expect(await t.storage.get(slot)).toBe(raw);
    } finally {
      t.writer.dispose();
    }
  },
);
test.each([
  { status: 401, code: 'E_AUTH_TOKEN_EXPIRED' },
  { status: 403, code: 'E_RBAC_FORBIDDEN' },
  { status: 412, code: 'E_GEN_VERSION_CONFLICT' },
])(
  'a replay HTTP$status does not erase the original uncertain operation',
  async ({ status, code }) => {
    const t = await setup();
    try {
      t.s.response = async () => {
        throw Error('synthetic');
      };
      await t.writer.start(task, 'IN_PROGRESS');
      const pending = await t.storage.get(slot);
      t.s.response = async () => errorResponse(status, code);
      await t.writer.retry();
      expect(t.writer.state.phase).toBe('needsReview');
      // Only local review metadata changes; every original request/binding field remains exact.
      expect(JSON.parse((await t.storage.get(slot))!)).toEqual({
        ...JSON.parse(pending!),
        review: true,
      });
      expect(t.writer.canStart).toBe(false);
    } finally {
      t.writer.dispose();
    }
  },
);
test('a first canonical 412 requires fresh user intent and never rebases or automatically resends', async () => {
  const t = await setup();
  try {
    t.s.response = async () => errorResponse(412, 'E_GEN_VERSION_CONFLICT');
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.writer.state.phase).toBe('conflict');
    expect(t.s.writes).toHaveLength(1);
    expect(await t.storage.get(slot)).toBeNull();
  } finally {
    t.writer.dispose();
  }
});
test('resource401 never refreshes/replays authentication', async () => {
  const t = await setup();
  try {
    t.s.response = async () => errorResponse(401, 'E_AUTH_TOKEN_EXPIRED');
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.s.writes).toHaveLength(1);
    expect(t.s.paths.some((p) => p.endsWith('/refresh'))).toBe(false);
    expect(t.writer.state.phase).toBe('expired');
  } finally {
    t.writer.dispose();
  }
});
test('offline preflight cannot send a mutation or create a pending intent', async () => {
  const t = await setup();
  try {
    t.s.online = false;
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.s.writes).toHaveLength(0);
    expect(await t.storage.get(slot)).toBeNull();
    expect(t.writer.canStart).toBe(false);
  } finally {
    t.writer.dispose();
  }
});
