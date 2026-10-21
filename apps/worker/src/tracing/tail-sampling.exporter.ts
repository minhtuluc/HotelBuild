import { ExportResultCode } from '@opentelemetry/core';
import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { forcedByOutcome, traceIdSamples } from './sampling.js';

/** Phần của span mà bộ lọc cần — nhận `ReadableSpan` của SDK, cũng nhận span giả trong test. */
export interface FilterableSpan {
  readonly spanContext: () => { readonly traceId: string };
  readonly status: { readonly code: number };
  readonly attributes: Readonly<Record<string, unknown>>;
}

const MAX_REMEMBERED_TRACES = 2048;

/** Gương của `apps/api/src/infrastructure/tracing/tail-sampling.exporter.ts` (cùng quy tắc). */
export function selectSampled<T extends FilterableSpan>(
  spans: readonly T[],
  ratio: number,
  remembered: Set<string>,
): T[] {
  const grouped = new Map<string, T[]>();
  for (const span of spans) {
    const traceId = span.spanContext().traceId;
    const group = grouped.get(traceId);
    if (group === undefined) grouped.set(traceId, [span]);
    else group.push(span);
  }
  const selected: T[] = [];
  for (const [traceId, group] of grouped) {
    if (forcedByOutcome(group)) rememberTrace(remembered, traceId);
    if (remembered.has(traceId) || traceIdSamples(traceId, ratio)) selected.push(...group);
  }
  return selected;
}

function rememberTrace(remembered: Set<string>, traceId: string): void {
  if (remembered.has(traceId)) return;
  remembered.add(traceId);
  if (remembered.size > MAX_REMEMBERED_TRACES) {
    const oldest = remembered.values().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
}

/**
 * Lọc mẫu lúc xuất span của worker: việc lỗi (bất kể hàng đợi) và việc chạm tiền luôn được giữ 100%, còn
 * việc thành công chỉ đi theo tỉ lệ. Lỗi exporter nằm trong BatchSpanProcessor nên không ảnh hưởng job.
 */
export class TailSamplingExporter implements SpanExporter {
  private readonly remembered = new Set<string>();

  constructor(
    private readonly delegate: SpanExporter,
    private readonly ratio: number,
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const selected = selectSampled(spans, this.ratio, this.remembered);
    if (selected.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.delegate.export(selected, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush?.() ?? Promise.resolve();
  }
}
