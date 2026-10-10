import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { WorkerConfig } from './config/env.js';
import type { WorkerLogger } from './logger.js';
import type { JobLike, QueueLike, WorkerDeps, WorkerLike } from './worker-app.js';

/** `REDIS_URL` → tuỳ chọn kết nối (không kèm khoá nào bằng `undefined`). */
export function redisOptions(url: string): ConnectionOptions {
  const parsed = new URL(url);
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    db,
    ...(parsed.username ? { username: parsed.username } : {}),
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

/** Cổng tạo client BullMQ — bơm được để test không cần Redis. */
export interface BullmqConstructors {
  createQueue(name: string, connection: ConnectionOptions): QueueLike;
  createWorker(
    name: string,
    connection: ConnectionOptions,
    concurrency: number,
    handler: (job: JobLike) => Promise<void>,
  ): WorkerLike;
}

export function bullmqConstructors(): BullmqConstructors {
  return {
    createQueue: (name, connection) => new Queue(name, { connection }),
    createWorker: (name, connection, concurrency, handler) =>
      new Worker<unknown, void>(
        name,
        (job) => handler({ id: job.id, name: job.name, data: job.data }),
        {
          connection,
          concurrency,
        },
      ),
  };
}

/** Nối BullMQ vào `createWorkerApp`; Redis chỉ được nối khi có lệnh chạy. */
export function createBullmqDeps(
  config: WorkerConfig,
  logger: WorkerLogger,
  ctors: BullmqConstructors = bullmqConstructors(),
): WorkerDeps {
  const connection = redisOptions(config.REDIS_URL);
  return {
    createQueue: (name) => ctors.createQueue(name, connection),
    createWorker: (name, handler) =>
      ctors.createWorker(name, connection, config.WORKER_CONCURRENCY, handler),
    log: ({ queue, msg }) => logger.info({ queue }, msg),
  };
}
