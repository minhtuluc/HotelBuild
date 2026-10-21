import { SpanStatusCode } from '@opentelemetry/api';

/**
 * Chính sách lấy mẫu trace của worker — **gương** của `apps/api/src/infrastructure/tracing/sampling.ts`.
 * Cùng ngưỡng 10% và cùng quy tắc "việc lỗi/tiền luôn được giữ" để một trace xuyên hai tiến trình có một
 * cách hiểu duy nhất.
 */
export const DEFAULT_SAMPLE_RATIO = 0.1;

export const CRITICAL_ATTRIBUTE = 'pinehill.sampling.critical';
export const CRITICAL_PAYMENT = 'PAYMENT';

/** Hàng đợi tiền tệ: chi hoàn chạm tiền ra khỏi hệ thống nên trace luôn được giữ (NFR-OBS-03). */
export const PAYMENT_QUEUES: readonly string[] = ['q.refund-payout'];

export function clampSampleRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SAMPLE_RATIO;
  return Math.min(Math.max(value, DEFAULT_SAMPLE_RATIO), 1);
}

export function isPaymentQueue(queue: string): boolean {
  return PAYMENT_QUEUES.includes(queue);
}

export function traceIdSamples(traceId: string, ratio: number): boolean {
  if (ratio >= 1) return true;
  const bucket = Number.parseInt(traceId.slice(-8), 16);
  return Number.isFinite(bucket) && bucket / 0x1_0000_0000 < ratio;
}

export interface TraceSpanFacts {
  readonly status: { readonly code: number };
  readonly attributes: Readonly<Record<string, unknown>>;
}

export function forcedByOutcome(spans: readonly TraceSpanFacts[]): boolean {
  return spans.some(
    (span) =>
      span.status.code === SpanStatusCode.ERROR ||
      span.attributes[CRITICAL_ATTRIBUTE] === CRITICAL_PAYMENT,
  );
}

export function keepTrace(
  traceId: string,
  spans: readonly TraceSpanFacts[],
  ratio: number,
): boolean {
  return forcedByOutcome(spans) || traceIdSamples(traceId, ratio);
}
