import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { IdGenerator } from '@pinehill/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, catchError, finalize, throwError } from 'rxjs';
import type { Subscription } from 'rxjs';
import { AppError } from '../../common/app-error.js';
import { CONFIG } from '../../config/env.js';
import type { ApiConfig } from '../../config/env.js';
import { ID_GENERATOR } from '../ports.js';
import { ensureRequestTrace } from './request-trace.js';
import {
  CRITICAL_ATTRIBUTE,
  CRITICAL_PAYMENT,
  DEFAULT_SAMPLE_RATIO,
  isPaymentPath,
} from './sampling.js';
import { runWithTrace } from './trace-context.js';
import { TRACING } from './tokens.js';
import type { Tracing } from './tracing.js';

/**
 * Mở span cho mỗi request và chạy **toàn bộ** chuỗi xử lý trong ngữ cảnh trace (AsyncLocalStorage), nhờ
 * vậy log ở mọi tầng và bản ghi outbox phát sinh trong handler mang cùng `traceId` mà handler không phải
 * biết gì về tracing.
 *
 * Lỗi chỉ đánh dấu `ERROR` trên span và ghi **mã lỗi** ổn định — không ghi message/stack (NFR-SEC-04).
 */
@Injectable()
export class TracingInterceptor implements NestInterceptor {
  constructor(
    @Inject(TRACING) private readonly tracing: Tracing,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const trace = ensureRequestTrace(request.raw, {
      ids: this.ids,
      sampleRatio: this.config.OTEL_SAMPLE_RATIO ?? DEFAULT_SAMPLE_RATIO,
    });
    const route = request.routeOptions?.url ?? '/[unmatched]';
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const span = this.tracing.startServerSpan(trace, `HTTP ${request.method} ${route}`, {
      'http.request.method': request.method,
      'http.route': route,
      correlationId: trace.correlationId,
      ...(isPaymentPath(request.url) ? { [CRITICAL_ATTRIBUTE]: CRITICAL_PAYMENT } : {}),
    });
    let failed = false;

    return new Observable<unknown>((subscriber) => {
      let inner: Subscription | undefined;
      // Đăng ký bên trong ngữ cảnh trace: promise/handler phát sinh sau đó vẫn thấy cùng trace.
      runWithTrace(span.trace, () => {
        inner = next.handle().subscribe(subscriber);
      });
      return () => inner?.unsubscribe();
    }).pipe(
      catchError((error: unknown) => {
        failed = true;
        // 4xx là kết quả nghiệp vụ (validate/không thấy/xung đột), **không** phải lỗi server: chỉ 5xx mới
        // mang `ERROR`, nếu không SLI "không 5xx" sẽ báo động vì lưu lượng 4xx bình thường.
        span.fail(
          error instanceof AppError ? error.status : 500,
          error instanceof AppError ? error.code : null,
        );
        return throwError(() => error);
      }),
      // Filter lỗi chạy **sau** interceptor nên mã response lúc này chưa phải mã lỗi; chỉ ghi khi thành công.
      finalize(() => {
        if (!failed) span.respond(reply.statusCode);
        span.end();
      }),
    );
  }
}
