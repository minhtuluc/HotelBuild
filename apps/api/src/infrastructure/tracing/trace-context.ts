import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { TraceFlags } from '@opentelemetry/api';
import { parseTraceParent } from '@opentelemetry/core';

/**
 * Ngữ cảnh W3C `traceparent` (NFR-OBS-03) — **một** chỗ của API đọc/ghi mã này.
 *
 * API luôn có trace cho mỗi request: giữ mã của khách nếu hợp lệ, ngược lại sinh mới. Nhờ vậy log, bản ghi
 * `outbox_events` và job ở worker mang cùng một `traceId` mà không phải truyền tham số qua từng lớp.
 * `correlationId` vẫn là mã của hợp đồng (`X-Correlation-Id`, api.md §1.3) — hai mã nằm cạnh nhau để nối
 * trace với mã khách đang thấy trong thân lỗi.
 */
export const TRACEPARENT_HEADER = 'traceparent';

/** Phần trace dùng chung cho cả API lẫn worker (worker có bản sao ở `apps/worker/src/tracing`). */
export interface SpanTrace {
  readonly traceId: string;
  /** Span đã sinh ra mã này — span con của nó (worker) nối tiếp đúng chuỗi. */
  readonly spanId: string;
  readonly sampled: boolean;
}

export interface TraceContext extends SpanTrace {
  readonly correlationId: string;
}

const ZERO_TRACE_ID = '0'.repeat(32);
const ZERO_SPAN_ID = '0'.repeat(16);

/** Tách mã của khách; `null` khi thiếu/sai định dạng hoặc mang id toàn số 0 (W3C trace-context). */
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

export function newTrace(correlationId: string, sampled: boolean): TraceContext {
  return {
    traceId: randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
    sampled,
    correlationId,
  };
}

/**
 * Trace gắn với **đối tượng request** cho các dòng log phát ra sau khi handler xong: log hoàn tất của
 * pino-http chạy ở sự kiện `finish`, ngoài AsyncLocalStorage (chỉ còn giữ `res`, mà `res.req` trỏ lại
 * request). `WeakMap` nên không cần dọn: request rơi khỏi bộ nhớ là mục tương ứng biến mất.
 */
const requestTraces = new WeakMap<object, TraceContext>();

export function rememberRequestTrace(request: object, trace: TraceContext): void {
  requestTraces.set(request, trace);
}

export function requestTraceOf(request: object | undefined): TraceContext | undefined {
  return request === undefined ? undefined : requestTraces.get(request);
}

const storage = new AsyncLocalStorage<TraceContext>();

/** Chạy `run` trong ngữ cảnh trace — mọi log/outbox sinh ra bên trong mang cùng mã. */
export function runWithTrace<T>(trace: TraceContext, run: () => T): T {
  return storage.run(trace, run);
}

export function currentTrace(): TraceContext | undefined {
  return storage.getStore();
}

export function currentTraceId(): string | null {
  return storage.getStore()?.traceId ?? null;
}

export function currentCorrelationId(): string | null {
  return storage.getStore()?.correlationId ?? null;
}

/** Mã để ghi vào bản ghi đi ra (`outbox_events.payload_json`, dữ liệu job BullMQ). */
export function currentTraceparent(): string | null {
  const trace = storage.getStore();
  return trace === undefined ? null : traceparentOf(trace);
}
