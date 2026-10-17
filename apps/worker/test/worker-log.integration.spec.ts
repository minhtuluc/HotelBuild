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
    // Sự kiện `error` của chính kết nối (blip mạng, hoặc `REDIS_URL` trỏ DB ngoài dải của máy chủ Redis)
    // cũng ghi vào sink này; tên vận chuyển đã đặt tiền tố riêng của ca, nên bản ghi **của hàng đợi sản
    // phẩm** là tập duy nhất phải khớp: đúng một bản ghi nhận job, không kèm nội dung job.
    const records = logRecords(sink.records());
    expect(records.filter((record) => record.queue === 'q.outbox-relay')).toEqual([
      expect.objectContaining({
        level: 30,
        service: 'worker',
        queue: 'q.outbox-relay',
        msg: 'nhận job',
      }),
    ]);
    // Phần còn lại chỉ được là sự kiện lỗi vận chuyển của **chính ca này**: không lọt hàng đợi ca khác.
    for (const record of records.filter((entry) => entry.queue !== 'q.outbox-relay')) {
      expect(record.msg).toBe('BullMQ phát lỗi');
      expect(record.queue.startsWith(prefix)).toBe(true);
    }
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

/** Bản ghi log của worker: JSON object có `queue`/`msg` dạng chuỗi. */
type LogRecord = { queue: string; msg: string };

function isLogRecord(record: unknown): record is LogRecord {
  return (
    typeof record === 'object' &&
    record !== null &&
    'queue' in record &&
    typeof record.queue === 'string' &&
    'msg' in record &&
    typeof record.msg === 'string'
  );
}

/** Giữ nguyên bản ghi (kể cả `level`/`time`/`service`); bản ghi lạ làm ca đỏ, không bị bỏ qua. */
function logRecords(records: unknown[]): LogRecord[] {
  return records.map((record) => {
    if (!isLogRecord(record))
      throw new Error('Bản ghi log của worker phải có queue/msg dạng chuỗi');
    return record;
  });
}
