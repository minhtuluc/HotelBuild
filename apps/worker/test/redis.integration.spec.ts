/**
 * Redis thật qua BullMQ: HB-127 bắt buộc REDIS_URL; ca AC4 cũ giữ hành vi skip khi thiếu.
 * Chạy cục bộ: `pnpm infra:up` rồi `REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @pinehill/worker test`.
 */
import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';
import { bullmqConstructors, redisOptions } from '../src/bullmq.factory.js';
import type { JobLike } from '../src/worker-app.js';
import {
  checkRedisRecovery,
  checkSafeErrorsAndDefaultWiring,
  checkRestoreFailureCleanup,
} from './redis-errors.js';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  process.stderr.write('[skip] Không có REDIS_URL — bỏ qua ca hàng đợi thật (AC4).\n');
}

const opened: { close: () => Promise<void> }[] = [];

describe('HB-078 TD-01 — lỗi kết nối BullMQ', () => {
  it(
    'đóng client kể cả khi cổng proxy bị chiếm, không nuốt lỗi restore',
    checkRestoreFailureCleanup,
    20_000,
  );
  it(
    'log qua logger đã cấu hình, không đưa nội dung lỗi thô vào log',
    checkSafeErrorsAndDefaultWiring,
    20_000,
  );
  it.each([false, true])(
    'log và phục hồi Redis, unavailable ngay khi khởi động: %s',
    checkRedisRecovery,
    20_000,
  );
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((item) => item.close()));
});

async function withAdapter(
  data: unknown,
  handler: (job: JobLike) => Promise<void>,
  check: (
    job: Job<unknown, void>,
    events: QueueEvents,
    queue: Queue<unknown, void>,
  ) => Promise<void>,
): Promise<void> {
  if (!redisUrl) throw new Error('HB-127 cần REDIS_URL để kiểm adapter BullMQ thật');
  const connection = redisOptions(redisUrl);
  const name = `hb127-payload-${randomUUID()}`;
  const queue = new Queue<unknown, void>(name, { connection });
  const events = new QueueEvents(name, { connection });
  const worker = bullmqConstructors().createWorker(name, connection, 1, handler);
  try {
    await events.waitUntilReady();
    const job = await queue.add('payload-command', data, { jobId: 'payload-job' });
    await check(job, events, queue);
  } finally {
    try {
      await worker.close();
    } finally {
      try {
        await queue.obliterate({ force: true });
      } finally {
        await Promise.all([events.close(), queue.close()]);
      }
    }
  }
}

const payloadCases: { label: string; data: unknown }[] = [
  {
    label: 'eventId/key/version và dữ liệu lồng nhau',
    data: {
      eventId: 'event-fixture',
      key: 'property-room-date',
      version: '9007199254740993',
      nested: { entries: [{ active: false, count: 0 }], optional: null },
    },
  },
  { label: 'null', data: null },
  { label: 'mảng', data: [0, false, null, { key: 'fixture' }] },
  { label: 'số 0', data: 0 },
  { label: 'false', data: false },
  { label: 'chuỗi rỗng', data: '' },
  { label: 'chuỗi', data: 'fixture' },
];

describe('HB-127 — adapter BullMQ với Redis thật', () => {
  it.each(payloadCases)(
    'chuyển nguyên id/name/data: $label',
    async ({ data }) => {
      const received: unknown[] = [];
      await withAdapter(
        data,
        async (job) => {
          received.push(job);
        },
        async (job, events) => {
          await job.waitUntilFinished(events, 10_000);
          expect(received).toEqual([
            { id: 'payload-job', name: 'payload-command', data, attemptsMade: 0, maxAttempts: 0 },
          ]);
          expect(await job.getState()).toBe('completed');
        },
      );
    },
    20_000,
  );

  it('truyền payload rồi để BullMQ ghi nhận lỗi handler', async () => {
    const data = { eventId: 'failed-fixture', key: 'fixture', version: '7' };
    const received: unknown[] = [];
    await withAdapter(
      data,
      async (job) => {
        received.push(job);
        throw new Error('synthetic-handler-failure');
      },
      async (job, events, queue) => {
        await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow(
          'synthetic-handler-failure',
        );
        expect(received).toEqual([
          { id: 'payload-job', name: 'payload-command', data, attemptsMade: 0, maxAttempts: 0 },
        ]);
        expect(await job.getState()).toBe('failed');
        const persisted = await queue.getJob(job.id ?? '');
        expect(persisted?.failedReason).toBe('synthetic-handler-failure');
      },
    );
  }, 20_000);
});

describe.skipIf(!redisUrl)('q.outbox-relay với Redis thật', () => {
  it('job được handler nhận đúng một lần', async () => {
    const connection = redisOptions(redisUrl ?? '');
    const queue = new Queue('q.outbox-relay', { connection });
    const received: string[] = [];
    const worker = new Worker(
      'q.outbox-relay',
      async (job) => {
        received.push(job.name);
      },
      { connection },
    );
    opened.push(queue, worker);
    const completed = Promise.withResolvers<void>();
    worker.on('completed', () => completed.resolve());
    await worker.waitUntilReady();
    await queue.add('relay-once', { seq: 1 });
    await completed.promise;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toEqual(['relay-once']);
  }, 20_000);
});
