import type { PrismaClient } from '@prisma/client';
import type { WorkerConfig } from '../config/env.js';
import type { WorkerLogger } from '../logger.js';
import type { QueueName } from '../queues.js';
import type { Tracing } from '../tracing/tracing.js';

/**
 * Ngữ cảnh dùng chung cho mọi handler job: kết nối CSDL, đồng hồ và log đã lọc PII.
 * Handler KHÔNG tự tạo PrismaClient/đọc `process.env` — chỉ nhận qua ngữ cảnh này.
 */
export interface JobContext {
  readonly db: PrismaClient;
  /** Cấu hình đã kiểm của tiến trình (handler không tự đọc `process.env`). */
  readonly config: WorkerConfig;
  readonly clock: { now(): Date };
  /**
   * Log của handler: `errorCode` (nếu có) đẩy dòng log sang mức `error` với mã ổn định — không bao giờ
   * nhận message/stack thô (NFR-SEC-04).
   */
  readonly log: (entry: {
    queue: QueueName;
    msg: string;
    jobId?: string;
    errorCode?: string;
  }) => void;
  /** Quan sát (HB-181): dựng span cho việc tiêu thụ outbox; vắng thì chỉ lan truyền ngữ cảnh trace. */
  readonly tracing?: Tracing;
}

/**
 * Lượt chạy của job theo hàng đợi (BullMQ truyền vào qua `bullmq.factory.ts`): `attempt` bắt đầu từ 1,
 * `attempts` là tổng số lượt sẽ chạy. Handler cần biết lượt cuối để chỉ chốt trạng thái khi hết đường thử lại.
 */
export interface JobAttempt {
  readonly attempt: number;
  readonly attempts: number;
}

/**
 * Một handler nhận payload thô từ hàng đợi, tự kiểm schema trước khi dùng, và biết mình đang ở lượt thứ mấy.
 * `attempt` vắng khi handler được gọi thẳng (test) — khi đó coi như lượt cuối.
 */
export type JobHandler = (
  data: unknown,
  context: JobContext,
  attempt?: JobAttempt,
) => Promise<void>;

/** Hàng đợi nào chưa có handler thật thì rơi về handler log mặc định của `worker-app`. */
export type JobRegistry = Partial<Readonly<Record<QueueName, JobHandler>>>;

export type { WorkerLogger };
