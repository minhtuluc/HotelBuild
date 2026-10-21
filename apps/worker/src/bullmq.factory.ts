import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import type { WorkerConfig } from './config/env.js';
import type { WorkerLogger } from './logger.js';
import type { JobAttempt, JobContext, JobRegistry } from './jobs/types.js';
import type { JobLike, QueueLike, WorkerDeps, WorkerLike } from './worker-app.js';
import { createLogger } from './pino.logger.js';
import { CRITICAL_ATTRIBUTE, CRITICAL_PAYMENT, isPaymentQueue } from './tracing/sampling.js';
import { withJobTrace } from './tracing/tracing.js';
import type { Tracing } from './tracing/tracing.js';

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

/**
 * `REDIS_URL` → tuỳ chọn kết nối (không kèm khoá nào bằng `undefined`). Kiểu ioredis để dùng chung cho cả
 * BullMQ (nhận `RedisOptions` trong `ConnectionOptions`) và phiên Redis của lượt đối chiếu Hold (HB-078) —
 * một chỗ duy nhất phân tích URL.
 */
export function redisOptions(url: string): RedisOptions {
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
        (job) =>
          handler({
            id: job.id,
            name: job.name,
            data: job.data,
            attemptsMade: job.attemptsMade,
            maxAttempts: job.opts.attempts,
          }),
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

/** Handler thật cho từng hàng đợi; hàng đợi chưa có handler rơi về log mặc định. */
export interface JobDispatch {
  readonly handlers: JobRegistry;
  readonly context: JobContext;
  /** Quan sát (HB-181); vắng thì chỉ lan truyền ngữ cảnh trace, không xuất span. */
  readonly tracing?: Tracing;
}

/**
 * Lượt chạy hiện tại của job: BullMQ tăng `attemptsMade` **sau** khi lượt chạy xong nên lượt đầu là 0,
 * còn `opts.attempts = 0` nghĩa là chạy đúng một lượt. `attempt` kẹp trần để job bị đẩy lại thủ công
 * (`attemptsMade ≥ attempts`) vẫn được coi là lượt cuối.
 */
export function jobAttempt(job: JobLike): JobAttempt {
  const attempts = Math.max(job.maxAttempts ?? 0, 1);
  return { attempt: Math.min((job.attemptsMade ?? 0) + 1, attempts), attempts };
}

/** Nối BullMQ vào `createWorkerApp`; Redis chỉ được nối khi có lệnh chạy. */
export function createBullmqDeps(
  config: WorkerConfig,
  logger: WorkerLogger,
  ctors: BullmqConstructors = bullmqConstructors(logger),
  dispatch?: JobDispatch,
): WorkerDeps {
  const connection = redisOptions(config.REDIS_URL);
  return {
    createQueue: (name) => ctors.createQueue(name, connection),
    createWorker: (name, handler) =>
      ctors.createWorker(name, connection, config.WORKER_CONCURRENCY, async (job) => {
        const real = dispatch === undefined ? undefined : dispatch.handlers[name];
        const attempt = jobAttempt(job);
        // Mọi lượt chạy — kể cả lượt thử lại của BullMQ (giữ nguyên `data`) — nằm trong cùng trace.
        await withJobTrace(
          dispatch?.tracing,
          job.data,
          `job ${name}`,
          {
            'messaging.system': 'bullmq',
            'messaging.destination.name': name,
            'job.attempt': attempt.attempt,
            ...(isPaymentQueue(name) ? { [CRITICAL_ATTRIBUTE]: CRITICAL_PAYMENT } : {}),
          },
          async () => {
            if (real === undefined || dispatch === undefined) {
              await handler(job);
              return;
            }
            await real(job.data, dispatch.context, attempt);
          },
        );
      }),
    log: ({ queue, msg }) => logger.info({ queue }, msg),
  };
}
