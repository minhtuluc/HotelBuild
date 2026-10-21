import { Prisma } from '@prisma/client';
import { currentTraceFields } from '../tracing/trace-context.js';

export const OUTBOX_TRACEPARENT_KEY = 'traceparent';
export const OUTBOX_CORRELATION_KEY = 'correlationId';

/** Kiểu `payload_json` của Prisma — giữ nguyên để gán lại không cần ép kiểu. */
type OutboxPayload = Prisma.outbox_eventsCreateInput['payload_json'];

/** Ngữ cảnh quan sát đi kèm sự kiện outbox. */
export interface OutboxTrace {
  readonly traceparent: string;
  readonly correlationId: string;
}

/**
 * Gắn ngữ cảnh trace của request hiện tại (`traceparent` + `correlationId`) vào **payload** sự kiện outbox
 * (kiến trúc §9.2: mã đi theo sự kiện sang việc nền). Relay/consumer ở worker đọc lại đúng hai mã này để
 * span tiêu thụ nối tiếp trace gốc và log worker có cùng `correlationId`.
 *
 * Hàm thuần: chỉ thêm khoá còn thiếu khi payload là object thuần. Ngoài request (seed/CLI), payload là
 * primitive/`JsonNull`/mảng, hoặc đã có mã thì giữ nguyên — không đụng nghiệp vụ.
 */
export function withOutboxTrace(payload: OutboxPayload, trace: OutboxTrace | null): OutboxPayload {
  if (trace === null || payload === null || typeof payload !== 'object') return payload;
  // `Prisma.JsonNull` là object đặc biệt và mảng JSON không nhận thêm khoá ⇒ để nguyên.
  if (Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype) return payload;
  const hasTraceparent = Object.hasOwn(payload, OUTBOX_TRACEPARENT_KEY);
  const hasCorrelation = Object.hasOwn(payload, OUTBOX_CORRELATION_KEY);
  if (hasTraceparent && hasCorrelation) return payload;
  return {
    ...payload,
    ...(hasTraceparent ? {} : { [OUTBOX_TRACEPARENT_KEY]: trace.traceparent }),
    ...(hasCorrelation ? {} : { [OUTBOX_CORRELATION_KEY]: trace.correlationId }),
  };
}

/**
 * Extension Prisma: mọi `outbox_events.create` (kể cả trong transaction nghiệp vụ) tự mang ngữ cảnh trace.
 * Đặt ở tầng lưu trữ để **không** phải sửa từng producer và để producer thêm sau này cũng được phủ. Nơi ghi
 * bằng SQL thô (worker phát `RefundPaid`) tự chèn ngữ cảnh ở chỗ ghi.
 */
export function outboxTraceExtension() {
  return Prisma.defineExtension({
    name: 'outbox-trace-context',
    query: {
      outbox_events: {
        async create({ args, query }) {
          args.data.payload_json = withOutboxTrace(args.data.payload_json, currentTraceFields());
          return query(args);
        },
      },
    },
  });
}
