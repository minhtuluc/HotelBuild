import { PrismaClient } from '@prisma/client';
import type { WorkerConfig } from '../config/env.js';
import type { WorkerLogger } from '../logger.js';
import type { JobContext } from './types.js';

export interface JobRuntime {
  readonly context: JobContext;
  close(): Promise<void>;
}

/**
 * Dựng ngữ cảnh job cho tiến trình worker: Prisma (dùng `DATABASE_URL` đã kiểm ở config) và đồng hồ
 * hệ thống. Log chỉ nhận `queue`/`jobId`, không nhận payload (NFR-SEC-04).
 */
export function createJobRuntime(
  config: WorkerConfig,
  logger: WorkerLogger,
  now: () => Date = () => new Date(),
): JobRuntime {
  const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  return {
    context: {
      db,
      config,
      clock: { now },
      log: ({ queue, msg, jobId, errorCode }) => {
        // Log chỉ mang định danh hàng đợi, id job và mã lỗi ổn định — không bao giờ log payload (NFR-SEC-04).
        const text = jobId === undefined ? msg : `${msg} (job ${jobId})`;
        if (errorCode !== undefined) {
          logger.error({ queue, component: 'job', errorCode }, text);
          return;
        }
        logger.info({ queue }, text);
      },
    },
    close: async () => {
      await db.$disconnect();
    },
  };
}
