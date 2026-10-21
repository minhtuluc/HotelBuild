import { SpanStatusCode } from '@opentelemetry/api';

/**
 * Chính sách lấy mẫu trace (NFR-OBS-03) — **một** chỗ quyết định, dùng chung cho bộ lọc exporter bên dưới.
 *
 * Mặc định giữ ≥ 10% lưu lượng. Trace **lỗi** và trace **thanh toán** luôn được giữ 100%: quyết định mẫu
 * lúc bắt đầu span không thể biết request sẽ lỗi, nên tỉ lệ được áp ở lúc xuất span (xem
 * `tail-sampling.exporter.ts`) chứ không phải bằng sampler đầu-cuối.
 */
export const DEFAULT_SAMPLE_RATIO = 0.1;

export const CRITICAL_ATTRIBUTE = 'pinehill.sampling.critical';
export const CRITICAL_PAYMENT = 'PAYMENT';

/** Đường dẫn tiền tệ của API (sau tiền tố `/api/v1`): thanh toán, webhook PSP, hoàn tiền. */
export const PAYMENT_PATHS: readonly string[] = [
  '/payments',
  '/integrations/psp',
  '/refund-requests',
];

/** Tỉ lệ cấu hình được kẹp vào `[10%, 100%]` — dưới ngưỡng NFR là cấu hình sai, không phải lựa chọn. */
export function clampSampleRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SAMPLE_RATIO;
  return Math.min(Math.max(value, DEFAULT_SAMPLE_RATIO), 1);
}

export function isPaymentPath(url: string): boolean {
  const path = (url.split('?')[0] ?? '').replace(/^\/api\/v1/, '');
  return PAYMENT_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Quyết định theo `traceId` nên hai lần gọi trên cùng một trace luôn cho cùng kết quả. */
export function traceIdSamples(traceId: string, ratio: number): boolean {
  if (ratio >= 1) return true;
  const bucket = Number.parseInt(traceId.slice(-8), 16);
  return Number.isFinite(bucket) && bucket / 0x1_0000_0000 < ratio;
}

/** Hình dạng tối thiểu mà chính sách cần — `ReadableSpan` của SDK thoả interface này. */
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
