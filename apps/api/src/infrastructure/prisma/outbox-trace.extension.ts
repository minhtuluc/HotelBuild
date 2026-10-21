import { Prisma } from '@prisma/client';
import { currentTraceparent } from '../tracing/trace-context.js';

export const OUTBOX_TRACEPARENT_KEY = 'traceparent';

/** Kiểu `payload_json` của Prisma — giữ nguyên để gán lại không cần ép kiểu. */
type OutboxPayload = Prisma.outbox_eventsCreateInput['payload_json'];

/**
 * Gắn `traceparent` của request hiện tại vào **payload** sự kiện outbox (kiến trúc §9.2: mã đi theo sự kiện
 * sang việc nền). Relay/consumer ở worker đọc lại đúng mã này để span tiêu thụ nối tiếp trace gốc.
 *
 * Hàm thuần: chỉ thêm một khoá khi payload là object thuần và chưa có khoá đó. Ngoài request (seed/CLI),
 * payload là primitive/`JsonNull`/mảng, hoặc đã có mã thì giữ nguyên — không đụng nghiệp vụ.
 */
export function withOutboxTrace(payload: OutboxPayload, traceparent: string | null): OutboxPayload {
  if (traceparent === null || payload === null || typeof payload !== 'object') return payload;
  // `Prisma.JsonNull` là object đặc biệt và mảng JSON không nhận thêm khoá ⇒ để nguyên.
  if (Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype) return payload;
  if (Object.hasOwn(payload, OUTBOX_TRACEPARENT_KEY)) return payload;
  return { ...payload, [OUTBOX_TRACEPARENT_KEY]: traceparent };
}

/**
 * Extension Prisma: mọi `outbox_events.create` (kể cả trong transaction nghiệp vụ) tự mang trace context.
 * Đặt ở tầng lưu trữ để **không** phải sửa từng producer và để producer thêm sau này cũng được phủ.
 */
export function outboxTraceExtension() {
  return Prisma.defineExtension({
    name: 'outbox-trace-context',
    query: {
      outbox_events: {
        async create({ args, query }) {
          args.data.payload_json = withOutboxTrace(args.data.payload_json, currentTraceparent());
          return query(args);
        },
      },
    },
  });
}
