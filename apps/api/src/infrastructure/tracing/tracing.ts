import { SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { TextMapGetter } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AlwaysOnSampler, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { TRACEPARENT_HEADER, traceparentOf } from './trace-context.js';
import type { TraceContext } from './trace-context.js';

/** Thuộc tính span chỉ nhận giá trị vô hướng — không bao giờ nhận payload/PII (NFR-OBS-03). */
export type SpanAttributes = Readonly<Record<string, string | number | boolean>>;

export interface TracingOptions {
  readonly serviceName: string;
  readonly environment: string;
  /** Bỏ trống ⇒ **không** bật SDK, chỉ lan truyền `traceparent` (mặc định của dev). */
  readonly endpoint: string | undefined;
}

export interface ActiveSpan {
  /** Ngữ cảnh đang hoạt động; khi SDK bật, `spanId` là span thật để worker nối tiếp đúng chuỗi. */
  readonly trace: TraceContext;
  /**
   * Ghi kết quả lỗi của request. Chỉ 5xx mới đánh dấu `ERROR` (một lỗi server thật); 4xx là kết quả
   * nghiệp vụ bình thường, nếu đánh dấu lỗi thì SLI "không 5xx" sẽ báo động vì lưu lượng validate.
   */
  fail(status: number, errorCode: string | null): void;
  /** Ghi mã trạng thái HTTP của response thành công (dùng cho SLI lỗi 5xx nếu cần lọc theo mã). */
  respond(status: number): void;
  end(): void;
}

export interface Tracing {
  readonly enabled: boolean;
  startServerSpan(trace: TraceContext, name: string, attributes: SpanAttributes): ActiveSpan;
  shutdown(): Promise<void>;
}

const carrierGetter: TextMapGetter<Record<string, string>> = {
  get: (carrier, key) => carrier[key],
  keys: (carrier) => Object.keys(carrier),
};

const propagator = new W3CTraceContextPropagator();

function tracesUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}

function disabledTracing(): Tracing {
  return {
    enabled: false,
    startServerSpan: (activeTrace) => ({
      trace: activeTrace,
      fail: () => undefined,
      respond: () => undefined,
      end: () => undefined,
    }),
    shutdown: () => Promise.resolve(),
  };
}

/**
 * Bật OpenTelemetry cho API: exporter OTLP cấu hình bằng `OTEL_EXPORTER_OTLP_ENDPOINT`. Ứng dụng **xuất
 * đủ span** — lấy mẫu là việc của collector (`tail_sampling`), nên ở đây dùng `AlwaysOnSampler` và không
 * lọc gì thêm; đặt mẫu hai nơi sẽ làm mọi tỉ lệ SLO sai (HB-181 review P1).
 *
 * Bọc toàn bộ trong `try` — exporter/collector hỏng **không** được làm hỏng request (fail-open).
 */
export function startTracing(options: TracingOptions): Tracing {
  if (options.endpoint === undefined || options.endpoint.trim() === '') return disabledTracing();
  try {
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        'service.name': options.serviceName,
        'deployment.environment.name': options.environment,
      }),
      sampler: new AlwaysOnSampler(),
      spanProcessors: [
        new BatchSpanProcessor(new OTLPTraceExporter({ url: tracesUrl(options.endpoint) })),
      ],
    });
    provider.register();
    const tracer = trace.getTracer(options.serviceName);
    return {
      enabled: true,
      startServerSpan: (activeTrace, name, attributes) => {
        const parent = propagator.extract(
          context.active(),
          { [TRACEPARENT_HEADER]: traceparentOf(activeTrace) },
          carrierGetter,
        );
        const span = tracer.startSpan(name, { kind: SpanKind.SERVER, attributes }, parent);
        const spanContext = span.spanContext();
        return {
          trace:
            spanContext.traceId === activeTrace.traceId
              ? { ...activeTrace, spanId: spanContext.spanId }
              : activeTrace,
          end: () => span.end(),
          fail: (status, errorCode) => {
            span.setAttribute('http.response.status_code', status);
            if (status < 500) return;
            span.setStatus({
              code: SpanStatusCode.ERROR,
              ...(errorCode === null ? {} : { message: errorCode }),
            });
            if (errorCode !== null) span.setAttribute('errorCode', errorCode);
          },
          respond: (status) => {
            span.setAttribute('http.response.status_code', status);
          },
        };
      },
      shutdown: async () => {
        try {
          await provider.shutdown();
        } catch {
          // Tắt SDK lỗi không được chặn tiến trình đang tắt.
        }
      },
    };
  } catch {
    // Không log chi tiết lỗi cấu hình (URL có thể chứa thông tin nội bộ); chỉ báo một dòng cố định.
    console.error('Tracing: không khởi tạo được OpenTelemetry — tiếp tục không xuất span');
    return disabledTracing();
  }
}
