import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents } from 'bullmq';
import { expect, test } from 'vitest';
import {
  bullmqConstructors,
  createBullmqDeps,
  redisOptions,
  type BullmqConstructors,
} from '../src/bullmq.factory.js';
import { loadWorkerConfig } from '../src/config/env.js';
import { QUEUE_NAMES } from '../src/queues.js';
import { createWorkerApp, type JobLike } from '../src/worker-app.js';
import { jsonLogSink, privateText } from './log-privacy-fixtures.js';

test('real Redis preserves private job content without putting it into receipt logs', async () => {
  if (!process.env.REDIS_URL) throw Error('REDIS_URL is required for the privacy regression');
  const config = loadWorkerConfig({
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
    REDIS_URL: process.env.REDIS_URL,
  });
  const prefix = `hb181-privacy-${randomUUID()}-`;
  const sink = jsonLogSink();
  const actual = bullmqConstructors(sink.logger);
  const received: JobLike[] = [];
  // Only the transport namespace changes; the processor and serializer are real.
  const isolated: BullmqConstructors = {
    createQueue: (name, connection) => actual.createQueue(prefix + name, connection),
    createWorker: (name, connection, concurrency, handler) =>
      actual.createWorker(prefix + name, connection, concurrency, async (job) => {
        received.push(job);
        await handler(job);
      }),
  };
  const connection = redisOptions(config.REDIS_URL);
  const queues = QUEUE_NAMES.map((name) => new Queue(prefix + name, { connection }));
  const target = queues.find((queue) => queue.name === prefix + 'q.outbox-relay');
  if (!target) throw Error('Owned target queue was not created');
  const events = new QueueEvents(target.name, { connection });
  const app = createWorkerApp(config, createBullmqDeps(config, sink.logger, isolated));
  try {
    await events.waitUntilReady();
    await app.start();
    const id = `private-${randomUUID()}`;
    const data = { nested: { privateText } };
    const job = await target.add(privateText, data, { jobId: id });
    await job.waitUntilFinished(events, 10_000);
    sink.assertSafe();
    expect(sink.records()).toEqual([
      expect.objectContaining({
        level: 30,
        service: 'worker',
        queue: 'q.outbox-relay',
        msg: 'nhận job',
      }),
    ]);
    expect(received).toEqual([{ id, name: privateText, data, attemptsMade: 0, maxAttempts: 0 }]);
    const persisted = await target.getJob(id);
    expect(persisted?.name).toBe(privateText);
    expect(persisted?.data).toEqual(data);
    expect(await persisted?.getState()).toBe('completed');
  } finally {
    try {
      await app.stop();
      for (const queue of queues) await queue.obliterate({ force: true });
    } finally {
      await Promise.all([...queues.map((queue) => queue.close()), events.close()]);
    }
  }
}, 20_000);
