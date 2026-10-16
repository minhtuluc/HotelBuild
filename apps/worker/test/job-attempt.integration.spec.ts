import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents } from 'bullmq';
import { expect, test } from 'vitest';
import { bullmqConstructors, jobAttempt, redisOptions } from '../src/bullmq.factory.js';
import type { JobAttempt } from '../src/jobs/types.js';

/**
 * HB-163 — chốt lại giả định nền của vòng đời retry: BullMQ thật báo `attemptsMade` **trước** lượt đang
 * chạy (0 ở lượt đầu) nên handler phải đọc `attempt = attemptsMade + 1`; sai giả định này thì job lỗi
 * sẽ kẹt `RUNNING` hoặc bị đánh `FAILED` quá sớm.
 */
const redisUrl = process.env.REDIS_URL;

test.skipIf(!redisUrl)(
  'BullMQ thật cho lượt chạy 1..N qua adapter (attempt = attemptsMade + 1)',
  async () => {
    const connection = redisOptions(redisUrl ?? '');
    const name = `hb163-attempt-${randomUUID()}`;
    const queue = new Queue<unknown, void>(name, { connection });
    const events = new QueueEvents(name, { connection });
    const seen: JobAttempt[] = [];
    const worker = bullmqConstructors().createWorker(name, connection, 1, async (job) => {
      seen.push(jobAttempt(job));
      throw new Error('synthetic-retry');
    });
    try {
      await events.waitUntilReady();
      const job = await queue.add(
        'attempt-probe',
        { fixture: true },
        { attempts: 3, backoff: { type: 'fixed', delay: 10 } },
      );
      await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow('synthetic-retry');
      expect(seen).toEqual([
        { attempt: 1, attempts: 3 },
        { attempt: 2, attempts: 3 },
        { attempt: 3, attempts: 3 },
      ]);
      expect(await (await queue.getJob(job.id ?? ''))?.getState()).toBe('failed');
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await Promise.all([events.close(), queue.close()]);
    }
  },
  20_000,
);
