import pino from 'pino';
import type { WorkerLogger } from './logger.js';
import { currentCorrelationId, currentTraceId } from './tracing/trace-context.js';

/**
 * pino JSON ra stdout: có `level`, `time`, `pid`, `hostname`, `msg` như log của API.
 *
 * `mixin` đọc ngữ cảnh trace của job đang chạy nên **mọi** dòng log — kể cả log lỗi BullMQ phát ra ngoài
 * handler — đều mang `traceId`/`correlationId` (giá trị `null` khi ngoài job), đúng NFR-OBS-01.
 */
export function createLogger(
  level: string,
  // Điểm bơm đích ghi cho test (mặc định pino ghi ra stdout).
  destination?: pino.DestinationStream,
): WorkerLogger {
  const options: pino.LoggerOptions = {
    level,
    base: { service: 'worker' },
    mixin: () => ({ traceId: currentTraceId(), correlationId: currentCorrelationId() }),
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
