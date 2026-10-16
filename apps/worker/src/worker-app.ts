import { isRepeatableQueue, QUEUE_NAMES } from './queues.js';
import type { QueueName } from './queues.js';
import type { WorkerConfig } from './config/env.js';
import type { WorkerLogger } from './logger.js';

export interface QueueLike {
  add(name: string, data: unknown): Promise<unknown>;
  upsertJobScheduler(id: string, repeat: { every: number }): Promise<unknown>;
  close(): Promise<void>;
}

export interface WorkerLike {
  close(): Promise<void>;
}

export interface JobLike {
  id?: string | undefined;
  name: string;
  /** Payload từ hàng đợi; consumer kiểm schema trước khi dùng. */
  data: unknown;
  /** Số lượt BullMQ đã chạy xong trước lượt hiện tại (0 ở lượt đầu). */
  attemptsMade?: number | undefined;
  /** Tổng số lượt BullMQ sẽ chạy cho job này (`opts.attempts`; 0 = chạy đúng một lượt). */
  maxAttempts?: number | undefined;
}

export interface WorkerDeps {
  createQueue(name: QueueName): QueueLike;
  createWorker(name: QueueName, handler: (job: JobLike) => Promise<void>): WorkerLike;
  log(entry: { queue: QueueName; msg: string }): void;
}

export interface WorkerApp {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function repeatIntervalSeconds(config: WorkerConfig, name: QueueName): number | undefined {
  if (name === 'q.hold-expiry') return config.HOLD_EXPIRY_INTERVAL_SECONDS;
  if (name === 'q.outbox-relay') return config.OUTBOX_RELAY_INTERVAL_SECONDS;
  if (name === 'q.export-cleanup') return config.EXPORT_CLEANUP_INTERVAL_SECONDS;
  return undefined;
}

/**
 * Đăng ký đủ 5 hàng đợi; handler hiện chỉ log (nghiệp vụ thật ngoài phạm vi HB-006).
 * `stop()` ngừng nhận job, chờ job đang chạy tối đa `SHUTDOWN_TIMEOUT_SECONDS`, rồi đóng kết nối.
 */
export function createWorkerApp(config: WorkerConfig, deps: WorkerDeps): WorkerApp {
  const queues: QueueLike[] = [];
  const workers: WorkerLike[] = [];
  let stopped = false;
  return {
    async start(): Promise<void> {
      for (const name of QUEUE_NAMES) {
        const queue = deps.createQueue(name);
        queues.push(queue);
        workers.push(
          deps.createWorker(name, async () => deps.log({ queue: name, msg: 'nhận job' })),
        );
        const every = repeatIntervalSeconds(config, name);
        if (config.ENABLE_REPEATABLE_SCHEDULERS && isRepeatableQueue(name) && every !== undefined) {
          await queue.upsertJobScheduler(`${name}-scheduler`, { every: every * 1000 });
        }
      }
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      const timeout = Promise.withResolvers<void>();
      setTimeout(timeout.resolve, config.SHUTDOWN_TIMEOUT_SECONDS * 1000).unref();
      await Promise.race([Promise.all(workers.map((worker) => worker.close())), timeout.promise]);
      await Promise.all(queues.map((queue) => queue.close()));
    },
  };
}

/** SIGTERM/SIGINT: dừng worker, đóng kết nối, thoát 0 (AC3). */
export function installSignalHandlers(
  app: WorkerApp,
  exit: (code: number) => void,
  logger: WorkerLogger,
): void {
  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      app
        .stop()
        .then(() => {
          logger.info({ queue: 'all' }, `nhận ${signal}: đã dừng êm`);
          exit(0);
        })
        .catch(() => {
          logger.error(
            { queue: 'all', component: 'shutdown', errorCode: 'UNKNOWN' },
            `nhận ${signal}: dừng worker thất bại`,
          );
          exit(1);
        });
    });
  }
}
