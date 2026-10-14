import { expect, test } from 'vitest';
import { setup, task, errorResponse, ownerId } from './task-write-fixture';
test.each(['collision', 'ambiguous-denial'])(
  'manual-review status survives a coordinator remount: %s',
  async (kind) => {
    const t = await setup();
    let next = t.writer;
    try {
      if (kind === 'ambiguous-denial') {
        t.s.response = async () => {
          throw Error('synthetic lost acknowledgement');
        };
        await t.writer.start(task, 'IN_PROGRESS');
        t.s.response = async () => errorResponse(403, 'E_RBAC_FORBIDDEN');
        await t.writer.retry();
      } else {
        t.s.response = async () => errorResponse(409, 'E_SYS_IDEMPOTENCY_KEY_REUSED');
        await t.writer.start(task, 'IN_PROGRESS');
      }
      expect(t.writer.state.phase).toBe('needsReview');
      const before = t.s.writes.length;
      t.writer.dispose();
      next = t.makeWriter();
      await next.restore();
      expect(next.state.phase).toBe('needsReview');
      expect(next.canRetry).toBe(false);
      await next.retry();
      await next.start(task, 'DONE');
      expect(t.s.writes).toHaveLength(before);
      expect(await t.storage.get('housekeeping.pending.' + ownerId)).not.toBeNull();
    } finally {
      next.dispose();
      t.writer.dispose();
    }
  },
);
