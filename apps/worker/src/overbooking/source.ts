import type { JobContext } from '../jobs/types.js';
import { readScanInterval } from './interval.js';
import type { ScanScheduleSource } from './schedule.js';

/** Nguồn nhịp thật của tiến trình: đọc SystemSetting bằng Prisma của worker, log qua ngữ cảnh job. */
export function scanScheduleSource(context: JobContext): ScanScheduleSource {
  return {
    read: () => readScanInterval(context.db),
    report: (entry) => context.log(entry),
  };
}
