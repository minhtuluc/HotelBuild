/**
 * Đồng bộ lịch `q.overbooking-scan` với SystemSetting mà không cần triển khai lại.
 *
 * Một **identity** scheduler duy nhất (`OVERBOOKING_SCAN_SCHEDULER_ID`): đổi nhịp là `upsertJobScheduler`
 * lại đúng id đó nên BullMQ thay lịch cũ, không nhân lịch. Nhịp đọc ngay khi khởi động rồi đọc lại định kỳ;
 * đọc lỗi thì giữ nguyên nhịp đang chạy (không về 0, không dừng lịch).
 */
import {
  OVERBOOKING_SCAN_JOB,
  OVERBOOKING_SCAN_QUEUE,
  OVERBOOKING_SCAN_SCHEDULER_ID,
} from '../queues.js';
import type { QueueLike } from '../worker-app.js';
import { FALLBACK_INTERVAL, scanIntervalMs } from './interval.js';
import type { ScanInterval } from './interval.js';

/** Đọc lại setting mỗi phút: đủ nhanh để đổi cấu hình có hiệu lực, không thành tải lên CSDL. */
export const SCAN_RELOAD_MS = 60_000;

export interface ScanScheduleSource {
  read(): Promise<ScanInterval>;
  report(entry: { queue: typeof OVERBOOKING_SCAN_QUEUE; msg: string; errorCode?: string }): void;
}

export interface ScanScheduleSync {
  start(): Promise<void>;
  /** Đọc lại một lần ngay (dùng cho test và nhịp định kỳ). */
  reload(): Promise<void>;
  stop(): void;
  /** Nhịp (phút) đang áp; `undefined` trước `start()`. */
  current(): number | undefined;
}

export function createScanScheduleSync(
  queue: QueueLike,
  source: ScanScheduleSource,
  reloadMs: number = SCAN_RELOAD_MS,
): ScanScheduleSync {
  let applied: number | undefined;
  let lastReported = '';
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let reloading = false;

  const report = (interval: ScanInterval): void => {
    const key = `${interval.minutes}:${interval.source}`;
    if (key === lastReported) return;
    lastReported = key;
    const before = applied === undefined ? 'chưa có' : `${applied} phút`;
    source.report({
      queue: OVERBOOKING_SCAN_QUEUE,
      msg: `nhịp quét quá tải ${before} → ${interval.minutes} phút (scheduler ${OVERBOOKING_SCAN_SCHEDULER_ID}, nguồn ${interval.source})`,
      ...(interval.source === 'FALLBACK'
        ? { errorCode: 'OVERBOOKING_SCAN_INTERVAL_FALLBACK' }
        : {}),
    });
  };

  const apply = async (interval: ScanInterval): Promise<void> => {
    report(interval);
    if (interval.minutes === applied) return;
    await queue.upsertJobScheduler(
      OVERBOOKING_SCAN_SCHEDULER_ID,
      { every: scanIntervalMs(interval.minutes) },
      { name: OVERBOOKING_SCAN_JOB, data: {} },
    );
    applied = interval.minutes;
  };

  const reload = async (): Promise<void> => {
    if (stopped || reloading) return;
    reloading = true;
    try {
      const interval = await source.read();
      if (!stopped) await apply(interval);
    } catch {
      source.report({
        queue: OVERBOOKING_SCAN_QUEUE,
        msg: 'không đọc được nhịp quét quá tải; giữ nhịp đang chạy',
        errorCode: 'OVERBOOKING_SCAN_INTERVAL_READ_FAILED',
      });
    } finally {
      reloading = false;
    }
  };

  return {
    async start() {
      await reload();
      // Chưa áp được nhịp nào (CSDL chưa sẵn sàng lúc khởi động): vẫn phải có lịch, dùng mặc định 60 phút.
      if (applied === undefined && !stopped) await apply(FALLBACK_INTERVAL);
      if (stopped) return;
      timer = setInterval(() => void reload(), reloadMs);
      timer.unref();
    },
    reload,
    stop() {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
    current: () => applied,
  };
}
