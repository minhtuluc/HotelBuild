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
      log: ({ queue, msg, jobId }) => {
        // Log chỉ mang định danh hàng đợi và id job — không bao giờ log payload (NFR-SEC-04).
        if (jobId === undefined) {
          logger.info({ queue }, msg);
          return;
        }
        logger.info({ queue }, `${msg} (job ${jobId})`);
      },
    },
    close: async () => {
      await db.$disconnect();
    },
  };
}
