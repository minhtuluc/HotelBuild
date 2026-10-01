/**
 * AC4 — hàng đợi thật: cần `REDIS_URL`; thiếu thì bỏ qua kèm thông báo (CI chưa có Redis; HB-007 thêm).
 * Chạy cục bộ: `pnpm infra:up` rồi `REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @pinehill/worker test`.
 */
import { Queue, Worker } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';
import { redisOptions } from '../src/bullmq.factory.js';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  process.stderr.write('[skip] Không có REDIS_URL — bỏ qua ca hàng đợi thật (AC4).\n');
}

const opened: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((item) => item.close()));
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
