import { SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { TextMapGetter } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AlwaysOnSampler, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { TRACEPARENT_HEADER, traceparentOf } from './trace-context.js';
import type { TraceContext } from './trace-context.js';
import { TailSamplingExporter } from './tail-sampling.exporter.js';

/** Thuộc tính span chỉ nhận giá trị vô hướng — không bao giờ nhận payload/PII (NFR-OBS-03). */
export type SpanAttributes = Readonly<Record<string, string | number | boolean>>;

export interface TracingOptions {
  readonly serviceName: string;
  readonly environment: string;
  /** Bỏ trống ⇒ **không** bật SDK, chỉ lan truyền `traceparent` (mặc định của dev). */
  readonly endpoint: string | undefined;
  readonly sampleRatio: number;
}

export interface ActiveSpan {
  /** Ngữ cảnh đang hoạt động; khi SDK bật, `spanId` là span thật để worker nối tiếp đúng chuỗi. */
  readonly trace: TraceContext;
  end(): void;
  /** Chỉ nhận **mã lỗi** ổn định; không nhận message/stack (NFR-SEC-04). */
  fail(errorCode: string | null): void;
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
      end: () => undefined,
      fail: () => undefined,
    }),
    shutdown: () => Promise.resolve(),
  };
}

/**
 * Bật OpenTelemetry cho API: exporter OTLP cấu hình bằng `OTEL_EXPORTER_OTLP_ENDPOINT`, lấy mẫu qua
 * {@link TailSamplingExporter}. Bọc toàn bộ trong `try` — exporter/collector hỏng **không** được làm hỏng
 * request (fail-open), cùng tinh thần với các cổng hạ tầng khác của API.
 */
export function startTracing(options: TracingOptions): Tracing {
  if (options.endpoint === undefined || options.endpoint.trim() === '') return disabledTracing();
  try {
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        'service.name': options.serviceName,
        'deployment.environment.name': options.environment,
      }),
      // Ghi nhận đủ rồi mới lọc lúc xuất: trace lỗi/thanh toán cần nguyên vẹn (NFR-OBS-03).
      sampler: new AlwaysOnSampler(),
      spanProcessors: [
        new BatchSpanProcessor(
          new TailSamplingExporter(
            new OTLPTraceExporter({ url: tracesUrl(options.endpoint) }),
            options.sampleRatio,
          ),
        ),
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
          fail: (errorCode) => {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              ...(errorCode === null ? {} : { message: errorCode }),
            });
            if (errorCode !== null) span.setAttribute('errorCode', errorCode);
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
