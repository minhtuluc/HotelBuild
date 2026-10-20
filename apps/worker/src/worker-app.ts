import {
  EXPORT_CLEANUP_JOB,
  HOLD_EXPIRY_JOB,
  HOLD_RECONCILE_JOB,
  isRepeatableQueue,
  OUTBOX_RELAY_JOB,
  QUEUE_NAMES,
  REFUND_PAYOUT_JOB,
} from './queues.js';
import type { QueueName } from './queues.js';
import { HOLD_EXPIRY_RECONCILE, HOLD_EXPIRY_SWEEP } from './jobs/hold-expiry/hold-expiry.job.js';
import type { WorkerConfig } from './config/env.js';
import type { WorkerLogger } from './logger.js';

export interface JobTemplate {
  readonly name: string;
  readonly data: unknown;
}

export interface QueueLike {
  add(name: string, data: unknown): Promise<unknown>;
  upsertJobScheduler(
    id: string,
    repeat: { every: number },
    template?: JobTemplate,
  ): Promise<unknown>;
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

export interface RepeatSchedule {
  readonly id: string;
  readonly everySeconds: number;
  readonly jobName: string;
  readonly data: unknown;
}

/**
 * Nhịp lặp của từng hàng đợi. Một hàng đợi có thể có **nhiều** nhịp: `q.hold-expiry` vừa quét 30 giây
 * (`HOLD_EXPIRY_INTERVAL_SECONDS`) vừa đối chiếu 900 giây (`HOLD_RECONCILE_INTERVAL_SECONDS`, BR-BOOK-18).
 * `data.mode` cho handler biết nhịp nào đang chạy — BullMQ không chuyển tên job vào handler.
 */
export function repeatSchedules(config: WorkerConfig, name: QueueName): readonly RepeatSchedule[] {
  if (name === 'q.hold-expiry')
    return [
      {
        id: 'q.hold-expiry-scheduler',
        everySeconds: config.HOLD_EXPIRY_INTERVAL_SECONDS,
        jobName: HOLD_EXPIRY_JOB,
        data: { mode: HOLD_EXPIRY_SWEEP },
      },
      {
        id: 'q.hold-expiry-reconcile-scheduler',
        everySeconds: config.HOLD_RECONCILE_INTERVAL_SECONDS,
        jobName: HOLD_RECONCILE_JOB,
        data: { mode: HOLD_EXPIRY_RECONCILE },
      },
    ];
  if (name === 'q.outbox-relay')
    return [
      {
        id: 'q.outbox-relay-scheduler',
        everySeconds: config.OUTBOX_RELAY_INTERVAL_SECONDS,
        jobName: OUTBOX_RELAY_JOB,
        data: {},
      },
    ];
  if (name === 'q.export-cleanup')
    return [
      {
        id: 'q.export-cleanup-scheduler',
        everySeconds: config.EXPORT_CLEANUP_INTERVAL_SECONDS,
        jobName: EXPORT_CLEANUP_JOB,
        data: {},
      },
    ];
  if (name === 'q.refund-payout')
    return [
      {
        id: 'q.refund-payout-scheduler',
        everySeconds: config.REFUND_PAYOUT_INTERVAL_SECONDS,
        jobName: REFUND_PAYOUT_JOB,
        data: {},
      },
    ];
  return [];
}

/**
 * Đăng ký mọi hàng đợi trong `QUEUE_NAMES`; handler thật nằm ở `jobs/registry.ts` (hàng đợi chưa có
 * nghiệp vụ rơi về handler log). `stop()` ngừng nhận job, chờ job đang chạy tối đa
 * `SHUTDOWN_TIMEOUT_SECONDS`, rồi đóng kết nối.
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
        if (config.ENABLE_REPEATABLE_SCHEDULERS && isRepeatableQueue(name)) {
          for (const schedule of repeatSchedules(config, name)) {
            await queue.upsertJobScheduler(
              schedule.id,
              { every: schedule.everySeconds * 1000 },
              { name: schedule.jobName, data: schedule.data },
            );
          }
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
