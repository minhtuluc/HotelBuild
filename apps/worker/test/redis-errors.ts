import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { Queue, Worker } from 'bullmq';
import { expect, vi } from 'vitest';
import { bullmqConstructors, createBullmqDeps, redisOptions } from '../src/bullmq.factory.js';
import { loadWorkerConfig } from '../src/config/env.js';
import type { WorkerLogger } from '../src/logger.js';
import type { QueueLike, WorkerLike } from '../src/worker-app.js';
import { redisProxy } from './redis-proxy.js';

function logSink() {
  const errors: { context: unknown; message: string }[] = [];
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
        try {
          if (!restored && queue instanceof Queue) await queue.connection.close(true);
          await Promise.all([queue.close(), admin.close()]);
        } finally {
          await proxy.close();
        }
      }
    }
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
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
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
    expect(queue.closed).toBe(true);
    expect(worker.closed).toBe(true);
    expect(admin.closed).toBe(true);
  } finally {
    try {
      await worker.close(true);
    } finally {
      try {
        await queue.connection.close(true);
      } finally {
        await Promise.all([queue.close(), admin.close(), proxy.close()]);
        if (blocker.listening) await new Promise<void>((resolve) => blocker.close(() => resolve()));
      }
    }
  }
}

/** Event thật trên các client thật; sink logger không thay adapter/hạ tầng đang kiểm. */
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
    queue.emit('error', error);
    worker.emit('error', error);
    worker.emit('error', Object.assign(new Error(secret), { code: secret }));
    queue.emit('error', new Error(secret));
    expect(errors).toEqual([
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
