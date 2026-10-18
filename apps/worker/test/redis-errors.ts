import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { Queue, Worker } from 'bullmq';
import { expect, vi } from 'vitest';
import { bullmqConstructors, createBullmqDeps, redisOptions } from '../src/bullmq.factory.js';
import { loadWorkerConfig } from '../src/config/env.js';
import type { WorkerLogger } from '../src/logger.js';
import type { QueueLike, WorkerLike } from '../src/worker-app.js';
import { redisProxy } from './redis-proxy.js';

/** Record đã qua cổng log của worker: đúng khoá mà `WorkerLogger.error` nhận. */
type ErrorRecord = { context: Parameters<WorkerLogger['error']>[0]; message: string };

function logSink() {
  const errors: ErrorRecord[] = [];
  const logger: WorkerLogger = {
    info: () => undefined,
    error: (context, message) => {
      errors.push({ context, message });
    },
  };
  return { logger, errors };
}

function requiredRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('HB-078 cần REDIS_URL để kiểm lỗi BullMQ thật');
  return url;
}

async function closeProbe(
  proxy: Awaited<ReturnType<typeof redisProxy>>,
  queue: QueueLike,
  worker: WorkerLike,
  admin: Queue,
): Promise<void> {
  let restored = false;
  try {
    await proxy.restore();
    restored = true;
  } finally {
    try {
      if (!restored && worker instanceof Worker) await worker.close(true);
      else await worker.close();
    } finally {
      try {
        await admin.obliterate({ force: true });
      } finally {
        await closeQueues(proxy, queue, admin, restored);
      }
    }
  }
}

async function closeQueues(
  proxy: Awaited<ReturnType<typeof redisProxy>>,
  queue: QueueLike,
  admin: Queue,
  restored: boolean,
): Promise<void> {
  try {
    if (!restored && queue instanceof Queue) {
      // ioredis dừng retry ngay; Queue.disconnect() có thể chờ event end đã phát trước đó.
      (await queue.client).disconnect();
    }
    await Promise.all([queue.close(), admin.close()]);
  } finally {
    await proxy.close();
  }
}

async function closeQueuesAndBlocker(
  queue: QueueLike,
  admin: QueueLike,
  proxy: Awaited<ReturnType<typeof redisProxy>>,
  blocker: ReturnType<typeof createServer>,
): Promise<void> {
  try {
    await Promise.all([queue.close(), admin.close(), proxy.close()]);
  } finally {
    if (blocker.listening) await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
}

export async function checkRedisRecovery(initiallyDown: boolean): Promise<void> {
  const proxy = await redisProxy(requiredRedisUrl());
  if (initiallyDown) await proxy.cut();
  const name = `hb078-errors-${randomUUID()}`;
  const { logger, errors } = logSink();
  const connection = redisOptions(proxy.url);
  const ctors = bullmqConstructors(logger);
  const queue = ctors.createQueue(name, connection);
  const received: unknown[] = [];
  const worker = ctors.createWorker(name, connection, 1, async (job) => {
    received.push(job);
  });
  const admin = new Queue(name, { connection: redisOptions(requiredRedisUrl()) });
  try {
    if (!initiallyDown) {
      await queue.add('before-cut', { phase: 'before' });
      await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 5000 });
      await proxy.cut();
    }
    await vi.waitFor(
      () => {
        for (const component of ['queue', 'worker']) {
          expect(errors).toContainEqual({
            context: { queue: name, component, errorCode: 'ECONNREFUSED' },
            message: 'BullMQ phát lỗi',
          });
        }
      },
      { timeout: 5000 },
    );
    await proxy.restore();
    const payload = { eventId: 'after-outage', version: '9007199254740993' };
    await queue.add('after-restore', payload);
    await vi.waitFor(
      () => {
        expect(received).toContainEqual(
          expect.objectContaining({ name: 'after-restore', data: payload }),
        );
      },
      { timeout: 10_000 },
    );
    expect(received).toHaveLength(initiallyDown ? 1 : 2);
  } finally {
    await closeProbe(proxy, queue, worker, admin);
  }
}

export async function checkRestoreFailureCleanup(): Promise<void> {
  const proxy = await redisProxy(requiredRedisUrl());
  const name = `hb078-cleanup-${randomUUID()}`;
  const { logger } = logSink();
  const ctors = bullmqConstructors(logger);
  const connection = redisOptions(proxy.url);
  const queue = ctors.createQueue(name, connection);
  const worker = ctors.createWorker(name, connection, 1, async () => undefined);
  const admin = new Queue(name, { connection: redisOptions(requiredRedisUrl()) });
  const blocker = createServer((socket) => socket.destroy());
  if (!(queue instanceof Queue) || !(worker instanceof Worker)) throw new Error('Cần client thật');
  try {
    const [queueClient, workerClient, adminClient] = await Promise.all([
      queue.waitUntilReady(),
      worker.waitUntilReady(),
      admin.waitUntilReady(),
    ]);
    const job = await queue.add('cleanup-fixture', {});
    await vi.waitFor(async () => {
      const persisted = await admin.getJob(
        job instanceof Object && 'id' in job && typeof job.id === 'string' ? job.id : '',
      );
      expect(await persisted?.getState()).toBe('completed');
    });
    await proxy.cut();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(Number(new URL(proxy.url).port), '127.0.0.1', () => {
        blocker.removeListener('error', reject);
        resolve();
      });
    });
    await expect(closeProbe(proxy, queue, worker, admin)).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
    expect(queueClient.status).toBe('end');
    expect(workerClient.status).toBe('end');
    expect(adminClient.status).toBe('end');
    expect(worker.isRunning()).toBe(false);
  } finally {
    try {
      await worker.close(true);
    } finally {
      try {
        (await queue.client).disconnect();
      } finally {
        await closeQueuesAndBlocker(queue, admin, proxy, blocker);
      }
    }
  }
}

/**
 * Event thật trên các client thật; sink logger không thay adapter/hạ tầng đang kiểm.
 *
 * Sink chỉ thu record, không thu *nguồn* record: kết nối thật của chính ca này vẫn có thể bắn `error`
 * (blip mạng lúc khởi động, hoặc `ERR DB index is out of range` khi `REDIS_URL` trỏ DB ngoài dải của
 * máy chủ Redis) trước cửa sổ phát lỗi tổng hợp. Vì vậy ca khẳng định **đúng cửa sổ đồng bộ** của 4
 * sự kiện do chính nó phát (`emit` gọi listener ngay, không await ⇒ không sự kiện nào chen vào giữa),
 * cộng thêm hai bất biến trên **toàn bộ** sink: mọi record đều thuộc tên hàng đợi của chính ca (không
 * lọt sự kiện của ca khác) và không record nào mang nội dung lỗi thô (NFR-SEC-04).
 */
export async function checkSafeErrorsAndDefaultWiring(): Promise<void> {
  const { logger, errors } = logSink();
  const config = loadWorkerConfig({
    DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture',
    REDIS_URL: requiredRedisUrl(),
  });
  const deps = createBullmqDeps(config, logger);
  const queue = deps.createQueue('q.hold-expiry');
  const workerName = `hb078-logger-${randomUUID()}`;
  const connection = redisOptions(requiredRedisUrl());
  const worker = bullmqConstructors(logger).createWorker(
    workerName,
    connection,
    1,
    async () => undefined,
  );
  const admin = new Queue(workerName, { connection });
  try {
    if (!(queue instanceof Queue) || !(worker instanceof Worker))
      throw new Error('Cần client thật');
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
    const secret = 'fixture-token-guest@example.test-redis://user:password@fixture';
    const error = Object.assign(new Error(secret), { code: 'ECONNRESET', payload: secret });
    // Mốc lấy ngay trước 4 `emit`: listener của BullMQ chạy đồng bộ nên `errors.slice(mark)` chỉ chứa
    // record của 4 sự kiện này, dù trước đó kết nối thật đã kịp ghi sự kiện lỗi của nó.
    const mark = errors.length;
    queue.emit('error', error);
    worker.emit('error', error);
    worker.emit('error', Object.assign(new Error(secret), { code: secret }));
    queue.emit('error', new Error(secret));
    expect(errors.slice(mark)).toEqual([
      {
        context: { queue: 'q.hold-expiry', component: 'queue', errorCode: 'ECONNRESET' },
        message: 'BullMQ phát lỗi',
      },
      {
        context: { queue: workerName, component: 'worker', errorCode: 'ECONNRESET' },
        message: 'BullMQ phát lỗi',
      },
      {
        context: { queue: workerName, component: 'worker', errorCode: 'UNKNOWN' },
        message: 'BullMQ phát lỗi',
      },
      {
        context: { queue: 'q.hold-expiry', component: 'queue', errorCode: 'UNKNOWN' },
        message: 'BullMQ phát lỗi',
      },
    ]);
    // Hermetic + an toàn cho **mọi** record, kể cả sự kiện lỗi thật của kết nối: chỉ sự kiện của chính
    // ca này, chỉ message an toàn, chỉ 3 khoá ngữ cảnh (không message/stack/payload thô lọt vào).
    for (const entry of errors) {
      expect(['q.hold-expiry', workerName]).toContain(entry.context.queue);
      expect(entry.message).toBe('BullMQ phát lỗi');
      expect(Object.keys(entry.context).sort()).toEqual(['component', 'errorCode', 'queue']);
    }
    expect(JSON.stringify(errors)).not.toContain(secret);
  } finally {
    try {
      await worker.close();
    } finally {
      try {
        await admin.obliterate({ force: true });
      } finally {
        await Promise.all([queue.close(), admin.close()]);
      }
    }
  }
}
