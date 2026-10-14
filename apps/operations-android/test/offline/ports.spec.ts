import { expect, test } from 'vitest';
import { OfflineQueue } from '../../src/offline/queue';
import { offlineContext, offlinePorts } from '../../src/offline/ports';
import { setup, task } from '../task-write-fixture';
import { key } from './fixture';

async function queueFixture() {
  const f = await setup();
  const ctx = offlineContext(f.actor, f.session.selectedProperty());
  const command = {
    kind: 'HOUSEKEEPING_STATUS',
    taskId: task.id,
    roomId: task.roomId,
    businessDate: task.businessDate,
    version: task.version,
    status: 'IN_PROGRESS',
  } as const;
  const queue = new OfflineQueue({
    ...offlinePorts(f.session, f.storage, () => f.s.now),
    context: ctx,
    storage: f.storage,
    online: async () => f.s.online,
    createId: () => key,
    now: () => f.s.now,
  });
  return { ...f, queue, ctx, command };
}

test('real Session/ApiClient ports send the published PATCH and match its DTO/version/ETag before confirming', async () => {
  const f = await queueFixture();
  try {
    await f.queue.draft(f.command);
    await f.queue.enqueue(key);
    await f.queue.sync();
    expect(f.s.writes).toHaveLength(1);
    expect(f.s.writes[0]).toMatchObject({
      body: '{"status":"IN_PROGRESS"}',
      key,
      tag: '"3"',
      bearer: 'Bearer synthetic-access-aaaaaaaaaaaaaaaaaaaa',
    });
    expect(f.s.writes[0]?.stored).toContain(key);
    expect(f.queue.snapshot()[0]?.phase).toBe('CONFIRMED');
    expect(await f.storage.get('housekeeping.pending.' + f.actor.userId)).toBeNull();
  } finally {
    f.queue.dispose();
    f.writer.dispose();
  }
});

test('an ambiguous existing online-writer intent blocks the offline adapter from sending another key', async () => {
  const f = await queueFixture();
  try {
    f.s.response = async () => {
      throw Error('connection lost');
    };
    await f.writer.start(task, 'IN_PROGRESS');
    expect(f.writer.state.phase).toBe('unknown');
    const pending = await f.storage.get('housekeeping.pending.' + f.actor.userId);
    await f.queue.draft(f.command);
    await f.queue.enqueue(key);
    await f.queue.sync();
    expect(f.s.writes).toHaveLength(1);
    expect(await f.storage.get('housekeeping.pending.' + f.actor.userId)).toBe(pending);
    expect(f.queue.snapshot()[0]?.phase).toBe('NEEDS_REVIEW');
  } finally {
    f.queue.dispose();
    f.writer.dispose();
  }
});

test('adapter rejects a wrong response entity instead of clearing the legacy request record', async () => {
  const f = await queueFixture();
  try {
    f.s.response = async () =>
      Response.json(
        { ...task, id: task.roomId, status: 'IN_PROGRESS', version: 4 },
        { headers: { etag: '"4"' } },
      );
    await f.queue.draft(f.command);
    await f.queue.enqueue(key);
    await f.queue.sync();
    expect(f.queue.snapshot()[0]?.reason).toBe('UNKNOWN_RESULT');
    expect(await f.storage.get('housekeeping.pending.' + f.actor.userId)).toContain(key);
  } finally {
    f.queue.dispose();
    f.writer.dispose();
  }
});

test('note/search drafts with no published command adapter cannot become server-confirmed', async () => {
  const f = await queueFixture();
  try {
    await f.queue.draft({ kind: 'NOTE_DRAFT', text: 'fixture note' });
    await f.queue.enqueue(key);
    await f.queue.sync();
    expect(f.s.writes).toHaveLength(0);
    expect(f.queue.snapshot()[0]).toMatchObject({
      phase: 'NEEDS_REVIEW',
      reason: 'UNSUPPORTED',
      attempted: false,
    });
    await f.queue.discard(key);
    expect(f.queue.snapshot()).toEqual([]);
  } finally {
    f.queue.dispose();
    f.writer.dispose();
  }
});

test('session property change invalidates queued data before any HTTP request', async () => {
  const f = await queueFixture();
  try {
    await f.queue.draft(f.command);
    await f.queue.enqueue(key);
    f.session.selectProperty(task.roomId);
    expect(f.queue.snapshot()).toEqual([]);
    await expect(f.queue.sync()).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
    expect(f.s.writes).toHaveLength(0);
  } finally {
    f.queue.dispose();
    f.writer.dispose();
  }
});

test.each([
  { when: 'before', change: { propertyScope: [] } },
  { when: 'after', change: { propertyScope: [] } },
  { when: 'before', change: { role: 'RESERVATION_AGENT' } },
  { when: 'after', change: { role: 'RESERVATION_AGENT' } },
])('fresh profile revocation via real ports clears RAM: %j', async ({ when, change }) => {
  const f = await queueFixture();
  try {
    await f.queue.draft(f.command);
    await f.queue.enqueue(key);
    if (when === 'before') Object.assign(f.actor, change);
    else
      f.s.response = async () => {
        Object.assign(f.actor, change);
        return Response.json(
          { ...task, status: 'IN_PROGRESS', version: 4 },
          { headers: { etag: '"4"' } },
        );
      };
    await f.queue.sync();
    expect(f.queue.snapshot()).toEqual([]);
    expect(f.s.writes).toHaveLength(when === 'before' ? 0 : 1);
    const raw = await f.storage.get('offline.queue.' + f.ctx.userId + '.' + f.ctx.propertyId);
    expect(raw).toContain('AUTHORIZATION');
    expect(raw).not.toContain('CONFIRMED');
    await expect(f.queue.restore()).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
  } finally {
    f.queue.dispose();
    f.writer.dispose();
  }
});
