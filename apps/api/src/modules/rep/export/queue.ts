import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { currentTraceparent } from '../../../infrastructure/tracing/trace-context.js';

export const REPORT_EXPORT_QUEUE = 'q.report-export';

/** Token DI cho hàng đợi (đóng kết nối khi module tắt). */
export const EXPORT_QUEUE = Symbol('EXPORT_QUEUE');

export interface ExportQueue {
  enqueue(operationId: string): Promise<void>;
  close(): Promise<void>;
}

/** `REDIS_URL` → tuỳ chọn kết nối BullMQ (không truyền khoá nào bằng `undefined`). */
function redisOptions(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    ...(parsed.username ? { username: parsed.username } : {}),
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

/**
 * Hàng đợi sinh tệp: API chỉ **đẩy job** (202 trả ngay), worker sinh CSV/XLSX.
 * `jobId = operationId` để một thao tác không bao giờ sinh hai job (đẩy lại là no-op).
 */
export function createExportQueue(redisUrl: string): ExportQueue {
  const queue = new Queue(REPORT_EXPORT_QUEUE, { connection: redisOptions(redisUrl) });
  return {
    enqueue: async (operationId) => {
      // `traceparent` đi cùng dữ liệu job nên lượt thử lại (BullMQ giữ nguyên `data`) vẫn cùng trace.
      const traceparent = currentTraceparent();
      await queue.add(
        'report-export',
        { operationId, ...(traceparent === null ? {} : { traceparent }) },
        {
          jobId: operationId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
    },
    close: async () => {
      await queue.close();
    },
  };
}
