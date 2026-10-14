import { expect, test } from 'vitest';
import { setup, task, ownerId, errorResponse } from './task-write-fixture';
import { memoryStorage } from '../src/storage';
const slot = 'housekeeping.pending.' + ownerId;
const ack = { ...task, status: 'IN_PROGRESS', version: 4 };
const other = '00000000-0000-4000-8000-000000000999';
test.each([
  { name: 'task identity', body: { ...ack, id: other }, tag: '"4"' },
  { name: 'room identity', body: { ...ack, roomId: other }, tag: '"4"' },
  { name: 'date', body: { ...ack, businessDate: '2026-11-02' }, tag: '"4"' },
  { name: 'assignee', body: { ...ack, assignedTo: other }, tag: '"4"' },
  { name: 'status', body: { ...ack, status: 'DONE' }, tag: '"4"' },
  { name: 'unchanged version', body: { ...ack, version: 3 }, tag: '"3"' },
  {
    name: 'unsafe version',
    body: { ...ack, version: Number.MAX_SAFE_INTEGER + 1 },
    tag: '"9007199254740992"',
  },
  { name: 'ETag', body: ack, tag: '"3"' },
  {
    name: 'private guest field',
    body: { ...ack, guestName: 'SYNTHETIC_PRIVATE_GUEST' },
    tag: '"4"',
  },
])('invalid ack $name never confirms or clears pending data', async ({ body, tag }) => {
  const t = await setup();
  try {
    t.s.response = async () => Response.json(body, { headers: { etag: tag } });
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.writer.state.phase).toBe('unknown');
    expect(await t.storage.get(slot)).not.toBeNull();
    expect(t.writer.canStart).toBe(false);
    expect(JSON.stringify(t.writer.state)).not.toContain('SYNTHETIC_PRIVATE_GUEST');
  } finally {
    t.writer.dispose();
  }
});
test('failed durable cleanup stays uncertain, then exact replay can finish cleanup', async () => {
  const storage = memoryStorage();
  let broken = true;
  const t = await setup({
    ...storage,
    remove: async (key) => {
      if (broken) throw Error('synthetic');
      await storage.remove(key);
    },
  });
  try {
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.writer.state.phase).toBe('unknown');
    const first = t.s.writes[0];
    broken = false;
    await t.writer.retry();
    expect(t.writer.state.phase).toBe('saved');
    expect(t.s.writes[1]).toEqual(first);
    expect(await storage.get(slot)).toBeNull();
  } finally {
    t.writer.dispose();
  }
});
test('server role change after commit cannot publish success or clear owner record', async () => {
  const t = await setup();
  try {
    t.s.response = async () => {
      t.actor.role = 'MANAGER';
      return Response.json(ack, { headers: { etag: '"4"' } });
    };
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.writer.state.phase).toBe('unknown');
    expect(await t.storage.get(slot)).not.toBeNull();
    await t.writer.retry();
    expect(t.writer.state.phase).toBe('forbidden');
    expect(t.s.writes).toHaveLength(1);
  } finally {
    t.writer.dispose();
  }
});
test('idempotency binding collision requires review, preserving the durable request', async () => {
  const t = await setup();
  try {
    t.s.response = async () => errorResponse(409, 'E_SYS_IDEMPOTENCY_KEY_REUSED');
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.writer.state.phase).toBe('needsReview');
    expect(await t.storage.get(slot)).not.toBeNull();
    await t.writer.retry();
    expect(t.s.writes).toHaveLength(1);
  } finally {
    t.writer.dispose();
  }
});
test('a request already in progress remains uncertain without automatic transport retry', async () => {
  const t = await setup();
  try {
    t.s.response = async () => errorResponse(409, 'E_SYS_REQUEST_IN_PROGRESS');
    await t.writer.start(task, 'IN_PROGRESS');
    expect(t.writer.state.phase).toBe('unknown');
    expect(t.s.writes).toHaveLength(1);
    expect(await t.storage.get(slot)).not.toBeNull();
  } finally {
    t.writer.dispose();
  }
});
test('the explicit DONE request is acknowledged using the server DTO, not local status prediction', async () => {
  const t = await setup();
  try {
    t.s.response = async () =>
      Response.json(
        { ...task, status: 'DONE', version: 5, completedAt: '2026-11-01T03:00:00Z' },
        { headers: { etag: '"5"' } },
      );
    await t.writer.start({ ...task, status: 'IN_PROGRESS', version: 4 }, 'DONE');
    expect(t.s.writes[0]).toMatchObject({ body: '{"status":"DONE"}', tag: '"4"' });
    expect(t.writer.state.phase).toBe('saved');
  } finally {
    t.writer.dispose();
  }
});
test.each([0, -1, Number.MAX_SAFE_INTEGER])(
  'unusable version %s never reaches storage or transport',
  async (version) => {
    const t = await setup();
    try {
      await t.writer.start({ ...task, version }, 'IN_PROGRESS');
      expect(t.writer.state.phase).toBe('validation');
      expect(t.s.writes).toHaveLength(0);
      expect(await t.storage.get(slot)).toBeNull();
    } finally {
      t.writer.dispose();
    }
  },
);
test('repeated submission while preflight is pending sends only one request', async () => {
  const t = await setup();
  try {
    await Promise.all([t.writer.start(task, 'IN_PROGRESS'), t.writer.start(task, 'DONE')]);
    expect(t.s.writes).toHaveLength(1);
    expect(t.s.writes[0]!.body).toBe('{"status":"IN_PROGRESS"}');
  } finally {
    t.writer.dispose();
  }
});
