import { SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { TextMapGetter } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AlwaysOnSampler, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { WorkerConfig } from '../config/env.js';
import { DEFAULT_SAMPLE_RATIO } from './sampling.js';
import { TailSamplingExporter } from './tail-sampling.exporter.js';
import {
  TRACEPARENT_HEADER,
  newTrace,
  runWithTrace,
  traceFromPayload,
  traceparentOf,
} from './trace-context.js';
import type { TraceContext } from './trace-context.js';

/** Chỉ thuộc tính vô hướng — không payload/PII (NFR-OBS-03). */
export type SpanAttributes = Readonly<Record<string, string | number | boolean>>;

export interface TracingOptions {
  readonly serviceName: string;
  /** Bỏ trống ⇒ không bật SDK (mặc định dev), chỉ lan truyền `traceparent` qua log/dữ liệu job. */
  readonly endpoint: string | undefined;
  readonly sampleRatio: number;
}

export interface JobSpan {
  /** Ngữ cảnh đang chạy — handler/log bên trong dùng mã này. */
  readonly trace: TraceContext;
  end(): void;
  fail(errorCode: string | null): void;
}

export interface Tracing {
  readonly enabled: boolean;
  startJobSpan(trace: TraceContext, name: string, attributes: SpanAttributes): JobSpan;
  shutdown(): Promise<void>;
}

const carrierGetter: TextMapGetter<Record<string, string>> = {
  get: (carrier, key) => carrier[key],
  keys: (carrier) => Object.keys(carrier),
};

const propagator = new W3CTraceContextPropagator();

/** Mã lỗi ổn định cho span thất bại — không lấy message của lỗi (có thể mang PII). */
const JOB_FAILED = 'JOB_FAILED';

function tracesUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}

function disabledTracing(): Tracing {
  return {
    enabled: false,
    startJobSpan: (activeTrace) => ({
      trace: activeTrace,
      end: () => undefined,
      fail: () => undefined,
    }),
    shutdown: () => Promise.resolve(),
  };
}

/**
 * Bật OpenTelemetry cho worker. Cấu hình lấy từ `WorkerConfig` (nơi duy nhất đọc `process.env`); endpoint
 * trống ⇒ không có span nào được ghi. Bọc `try` để cấu hình collector sai không làm worker chết (fail-open).
 */
export function startTracing(options: TracingOptions): Tracing {
  if (options.endpoint === undefined || options.endpoint.trim() === '') return disabledTracing();
  try {
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ 'service.name': options.serviceName }),
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
      startJobSpan: (activeTrace, name, attributes) => {
        const parent = propagator.extract(
          context.active(),
          { [TRACEPARENT_HEADER]: traceparentOf(activeTrace) },
          carrierGetter,
        );
        const span = tracer.startSpan(name, { kind: SpanKind.CONSUMER, attributes }, parent);
        const spanContext = span.spanContext();
        return {
          trace:
            spanContext.traceId === activeTrace.traceId
              ? { ...activeTrace, spanId: spanContext.spanId }
              : activeTrace,
          end: () => span.end(),
          fail: (errorCode) => {
            span.setStatus({ code: SpanStatusCode.ERROR, message: errorCode ?? JOB_FAILED });
            span.setAttribute('errorCode', errorCode ?? JOB_FAILED);
          },
        };
      },
      shutdown: async () => {
        try {
          await provider.shutdown();
        } catch {
          // Tắt SDK lỗi không chặn tiến trình đang tắt.
        }
      },
    };
  } catch {
    console.error('Tracing: không khởi tạo được OpenTelemetry — worker tiếp tục không xuất span');
    return disabledTracing();
  }
}

/** Dựng cấu hình tracing từ `WorkerConfig` (không handler nào tự đọc `process.env`). */
export function tracingFromConfig(config: WorkerConfig): Tracing {
  return startTracing({
    serviceName: 'worker',
    endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
    sampleRatio: config.OTEL_SAMPLE_RATIO ?? DEFAULT_SAMPLE_RATIO,
  });
}

/**
 * Chạy `run` trong ngữ cảnh `trace`, mở span nếu SDK bật, và đánh dấu `ERROR` khi lỗi rồi **ném lại** —
 * job vẫn thất bại như trước, tracing không đổi hành vi nghiệp vụ.
 */
export async function withTrace<T>(
  tracing: Tracing | undefined,
  traceContext: TraceContext,
  name: string,
  attributes: SpanAttributes,
  run: () => Promise<T>,
): Promise<T> {
  const span = tracing?.startJobSpan(traceContext, name, attributes);
  try {
    return await runWithTrace(span?.trace ?? traceContext, run);
  } catch (error) {
    span?.fail(null);
    throw error;
  } finally {
    span?.end();
  }
}

/** Như {@link withTrace} nhưng lấy trace từ dữ liệu job — lượt thử lại giữ nguyên `data` nên cùng trace. */
export function withJobTrace<T>(
  tracing: Tracing | undefined,
  data: unknown,
  name: string,
  attributes: SpanAttributes,
  run: () => Promise<T>,
): Promise<T> {
  const traceContext = traceFromPayload(data) ?? newTrace(null, false);
  return withTrace(tracing, traceContext, name, attributes, run);
}
