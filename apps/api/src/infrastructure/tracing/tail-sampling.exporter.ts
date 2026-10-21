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

/**
 * Chọn span được xuất, theo **trace** chứ không theo từng span: một trace lỗi hoặc thanh toán phải đi trọn
 * vẹn, nên chỉ cần một span đủ điều kiện là cả nhóm được giữ. `remembered` ghi nhớ trace đã được giữ để
 * các span cùng trace ở **lô xuất sau** (BatchSpanProcessor cắt lô theo thời gian) không bị mất.
 */
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
  // Bộ nhớ có trần: chỉ cần đủ để ghép các lô liền nhau, không phải lưu cả ngày.
  if (remembered.size > MAX_REMEMBERED_TRACES) {
    const oldest = remembered.values().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
}

/**
 * Bọc exporter OTLP bằng bộ lọc mẫu ở trên ("tail sampling" ngay trong tiến trình). SDK vẫn ghi nhận span
 * cục bộ; quyết định **gửi đi** mới áp tỉ lệ, nhờ vậy trace lỗi/thanh toán không bao giờ bị lấy mẫu rơi
 * mất. Lỗi mạng của exporter do BatchSpanProcessor xử lý — không ném ra đường xử lý request (fail-open).
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
