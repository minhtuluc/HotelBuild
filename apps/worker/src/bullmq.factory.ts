import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { WorkerConfig } from './config/env.js';
import type { WorkerLogger } from './logger.js';
import type { JobLike, QueueLike, WorkerDeps, WorkerLike } from './worker-app.js';
import { createLogger } from './pino.logger.js';

const connectionErrorCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** Không chuyển message/stack/payload từ thư viện vào log (có thể chứa bí mật/PII). */
function reportBullmqError(
  logger: WorkerLogger,
  queue: string,
  component: 'queue' | 'worker',
  error: unknown,
): void {
  const errorCode =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    connectionErrorCodes.has(error.code)
      ? error.code
      : 'UNKNOWN';
  logger.error({ queue, component, errorCode }, 'BullMQ phát lỗi');
}

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

export function bullmqConstructors(
  logger: WorkerLogger = createLogger('info'),
): BullmqConstructors {
  return {
    createQueue: (name, connection) => {
      const queue = new Queue(name, { connection });
      queue.on('error', (error: unknown) => reportBullmqError(logger, name, 'queue', error));
      return queue;
    },
    createWorker: (name, connection, concurrency, handler) => {
      const worker = new Worker<unknown, void>(
        name,
        (job) => handler({ id: job.id, name: job.name, data: job.data }),
        {
          connection,
          concurrency,
        },
      );
      worker.on('error', (error: unknown) => reportBullmqError(logger, name, 'worker', error));
      return worker;
    },
  };
}

/** Nối BullMQ vào `createWorkerApp`; Redis chỉ được nối khi có lệnh chạy. */
export function createBullmqDeps(
  config: WorkerConfig,
  logger: WorkerLogger,
  ctors: BullmqConstructors = bullmqConstructors(logger),
): WorkerDeps {
  const connection = redisOptions(config.REDIS_URL);
  return {
    createQueue: (name) => ctors.createQueue(name, connection),
    createWorker: (name, handler) =>
      ctors.createWorker(name, connection, config.WORKER_CONCURRENCY, handler),
    log: ({ queue, msg }) => logger.info({ queue }, msg),
  };
}
