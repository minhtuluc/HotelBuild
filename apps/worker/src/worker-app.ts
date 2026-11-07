import {
  ALERTS_SCAN_JOB,
  CHANNEL_SYNC_JOB,
  EXPORT_CLEANUP_JOB,
  HOLD_EXPIRY_JOB,
  HOLD_RECONCILE_JOB,
  NO_SHOW_MARK_JOB,
  OTA_INBOX_JOB,
  OUTBOX_RELAY_JOB,
  OVERBOOKING_SCAN_QUEUE,
  QUEUE_NAMES,
  REFUND_PAYOUT_JOB,
  isRepeatableQueue,
} from './queues.js';
import type { QueueName } from './queues.js';
import { HOLD_EXPIRY_RECONCILE, HOLD_EXPIRY_SWEEP } from './jobs/hold-expiry/hold-expiry.job.js';
import {
  CHANNEL_SYNC_SCHEDULER_ID,
  DEFAULT_INTERVAL_SECONDS,
} from './jobs/channel-sync/contract.js';
import { channelSyncIntervalSeconds } from './jobs/channel-sync/settings.js';
import type { WorkerConfig } from './config/env.js';
import type { WorkerLogger } from './logger.js';
import { createScanScheduleSync } from './overbooking/schedule.js';
import type { ScanScheduleSource, ScanScheduleSync } from './overbooking/schedule.js';

export interface JobTemplate {
  readonly name: string;
  readonly data: unknown;
}

export interface QueueLike {
  add(name: string, data: unknown): Promise<unknown>;
  upsertJobScheduler(
    id: string,
    repeat: { every: number; startDate?: number },
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
  /** Nguồn nhịp `q.overbooking-scan` (SystemSetting); vắng thì không đăng ký lịch quét. */
  readonly scanSchedule?: ScanScheduleSource;
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
  if (name === 'q.ota-inbox')
    return [
      {
        id: 'q.ota-inbox-scheduler',
        everySeconds: config.OTA_INBOX_INTERVAL_SECONDS,
        jobName: OTA_INBOX_JOB,
        data: {},
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
  if (name === 'q.alerts-scan')
    return [
      {
        id: 'q.alerts-scan-scheduler',
        everySeconds: config.ALERTS_SCAN_INTERVAL_SECONDS,
        jobName: ALERTS_SCAN_JOB,
        data: {},
      },
    ];
  if (name === 'q.channel-sync')
    return [
      {
        id: CHANNEL_SYNC_SCHEDULER_ID,
        everySeconds: DEFAULT_INTERVAL_SECONDS,
        jobName: CHANNEL_SYNC_JOB,
        data: {},
      },
    ];
  if (name === 'q.no-show-mark')
    return [
      {
        id: 'q.no-show-mark-scheduler',
        everySeconds: config.NO_SHOW_MARK_INTERVAL_SECONDS,
        jobName: NO_SHOW_MARK_JOB,
        data: {},
      },
    ];
  return [];
}

/**
 * Đăng ký các lịch lặp của **một** hàng đợi từ `repeatSchedules`. Tách khỏi `start()` để hàm đó không
 * vượt trần độ phức tạp khi mỗi hàng đợi thêm quy tắc nhịp riêng (HB-131, HB-127).
 */
async function registerRepeatSchedules(
  config: WorkerConfig,
  queue: QueueLike,
  name: QueueName,
): Promise<void> {
  // HB-131: nhịp `q.channel-sync` đọc từ `SystemSetting` lúc khởi động; đổi cấu hình rồi restart
  // là đổi nhịp, không cần triển khai lại (BR-SYS-02). Id scheduler không đổi nên không nhân đôi.
  const configuredInterval =
    name === 'q.channel-sync' ? await channelSyncIntervalSeconds(config.DATABASE_URL) : null;
  for (const schedule of repeatSchedules(config, name)) {
    const everySeconds =
      schedule.id === CHANNEL_SYNC_SCHEDULER_ID && configuredInterval !== null
        ? configuredInterval
        : schedule.everySeconds;
    const everyMs = everySeconds * 1000;
    // BullMQ tạo lượt chạy đầu **ngay** khi scheduler chưa có `startDate`; với kênh, lần quét đầu
    // đặt sau đúng một chu kỳ để restart không tự đẩy ảnh/đếm lỗi trước khi vận hành kịp kiểm tra.
    // Đồng bộ tức thì vẫn do outbox/API phát job, không phụ thuộc nhịp này (BR-CHAN-02).
    const repeat =
      schedule.id === CHANNEL_SYNC_SCHEDULER_ID
        ? { every: everyMs, startDate: Date.now() + everyMs }
        : { every: everyMs };
    await queue.upsertJobScheduler(schedule.id, repeat, {
      name: schedule.jobName,
      data: schedule.data,
    });
  }
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
  let scanSync: ScanScheduleSync | undefined;
  return {
    async start(): Promise<void> {
      for (const name of QUEUE_NAMES) {
        const queue = deps.createQueue(name);
        queues.push(queue);
        workers.push(
          deps.createWorker(name, async () => deps.log({ queue: name, msg: 'nhận job' })),
        );
        if (config.ENABLE_REPEATABLE_SCHEDULERS && isRepeatableQueue(name)) {
          await registerRepeatSchedules(config, queue, name);
          // HB-127: nhịp quét quá tải đến từ SystemSetting, không từ cấu hình tiến trình.
          if (name === OVERBOOKING_SCAN_QUEUE && deps.scanSchedule !== undefined) {
            scanSync = createScanScheduleSync(queue, deps.scanSchedule);
            await scanSync.start();
          }
        }
      }
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      // Ngừng đọc lại nhịp trước: không đăng ký thêm lịch quét trong lúc đóng.
      scanSync?.stop();
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
