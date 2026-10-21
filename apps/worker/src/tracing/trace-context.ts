import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { TraceFlags } from '@opentelemetry/api';
import { parseTraceParent } from '@opentelemetry/core';

/**
 * Ngữ cảnh W3C `traceparent` của worker — **gương** của `apps/api/src/infrastructure/tracing/trace-context.ts`
 * (hai app không dùng chung package, giống `noti/payload.ts`; mã hoá W3C do thư viện OpenTelemetry lo nên
 * không có công thức thứ hai).
 *
 * Worker **không** sinh trace cho từng việc: nó nhận mã của việc gốc qua dữ liệu job/outbox. Chỉ job do
 * nhịp lặp tự đăng ký (không có nguồn) mới sinh trace mới — khi đó log vẫn có `traceId` để tra cứu.
 */
export const TRACEPARENT_HEADER = 'traceparent';

export interface SpanTrace {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
}

export interface TraceContext extends SpanTrace {
  /** Mã tương quan của sự kiện gốc; `null` với job do worker tự nhịp. */
  readonly correlationId: string | null;
}

const ZERO_TRACE_ID = '0'.repeat(32);
const ZERO_SPAN_ID = '0'.repeat(16);

export function parseTraceparent(value: unknown): SpanTrace | null {
  if (typeof value !== 'string') return null;
  const parsed = parseTraceParent(value);
  if (parsed === null || parsed.traceId === ZERO_TRACE_ID || parsed.spanId === ZERO_SPAN_ID)
    return null;
  return {
    traceId: parsed.traceId,
    spanId: parsed.spanId,
    sampled: (parsed.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED,
  };
}

export function traceparentOf(trace: SpanTrace): string {
  const flags = trace.sampled ? TraceFlags.SAMPLED : TraceFlags.NONE;
  return `00-${trace.traceId}-${trace.spanId}-${flags.toString(16).padStart(2, '0')}`;
}

export function newTrace(correlationId: string | null, sampled: boolean): TraceContext {
  return {
    traceId: randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
    sampled,
    correlationId,
  };
}

/** Mã đi kèm dữ liệu job BullMQ: `{ traceparent?, correlationId? }` — chỉ đọc hai khoá này. */
export function traceFromPayload(data: unknown): TraceContext | null {
  if (typeof data !== 'object' || data === null) return null;
  const record: Record<string, unknown> = { ...data };
  const parsed = parseTraceparent(record[TRACEPARENT_HEADER]);
  if (parsed === null) return null;
  const correlationId = record['correlationId'];
  return { ...parsed, correlationId: typeof correlationId === 'string' ? correlationId : null };
}

/** Trace của một sự kiện outbox (payload đã commit) hoặc trace mới khi sự kiện cũ chưa có mã. */
export function resolveTrace(traceparent: unknown, correlationId: string | null): TraceContext {
  const parsed = parseTraceparent(traceparent);
  return parsed === null ? newTrace(correlationId, false) : { ...parsed, correlationId };
}

const storage = new AsyncLocalStorage<TraceContext>();

export function runWithTrace<T>(trace: TraceContext, run: () => T): T {
  return storage.run(trace, run);
}

export function currentTraceId(): string | null {
  return storage.getStore()?.traceId ?? null;
}

export function currentCorrelationId(): string | null {
  return storage.getStore()?.correlationId ?? null;
}

/** Hai mã ghi kèm bản ghi đi ra (payload outbox do worker phát) — `null` khi ngoài job. */
export interface TraceFields {
  readonly traceparent: string;
  readonly correlationId: string | null;
}

export function currentTraceFields(): TraceFields | null {
  const trace = storage.getStore();
  return trace === undefined
    ? null
    : { traceparent: traceparentOf(trace), correlationId: trace.correlationId };
}
