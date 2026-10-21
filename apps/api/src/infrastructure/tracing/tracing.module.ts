import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { ApiConfig } from '../../config/env.js';
import { TRACING } from './tokens.js';
import { startTracing } from './tracing.js';
import type { Tracing } from './tracing.js';
import { TracingInterceptor } from './tracing.interceptor.js';

/** Flush span còn trong bộ đệm khi tắt app; lỗi flush không chặn quá trình tắt (fail-open). */
@Injectable()
class TracingLifecycle {
  constructor(@Inject(TRACING) private readonly tracing: Tracing) {}

  async onApplicationShutdown(): Promise<void> {
    await this.tracing.shutdown();
  }
}

/**
 * Quan sát của API (HB-181): provider OpenTelemetry + interceptor trace. `OTEL_EXPORTER_OTLP_ENDPOINT` trống
 * ⇒ không bật SDK (mặc định dev), nhưng `traceparent` **vẫn** được lan truyền sang outbox/worker.
 */
@Global()
@Module({})
export class TracingModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: TracingModule,
      providers: [
        {
          provide: TRACING,
          useFactory: (): Tracing =>
            startTracing({
              serviceName: 'api',
              environment: config.NODE_ENV ?? 'development',
              endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
            }),
        },
        TracingLifecycle,
        { provide: APP_INTERCEPTOR, useClass: TracingInterceptor },
      ],
      exports: [TRACING],
    };
  }
}
