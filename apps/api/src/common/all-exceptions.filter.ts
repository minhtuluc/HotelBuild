import { Catch, HttpException, Inject } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { errorBodySchema } from '@pinehill/contracts';
import type { ErrorBody, ErrorCode } from '@pinehill/contracts';
import type { Clock, IdGenerator } from '@pinehill/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { InjectPinoLogger } from 'nestjs-pino';
import { CLOCK, ID_GENERATOR } from '../infrastructure/ports.js';
import { requestPath } from './safe-request.js';
import { AppError } from './app-error.js';
import { resolveCorrelationId } from './request-id.js';

/** Cổng log tối thiểu của filter; pino thật tiêm qua `@InjectPinoLogger`. */
export interface ErrorLogger {
  error(context: Record<string, unknown>, message: string): void;
}

const UNAVAILABLE = {
  code: 'E_GEN_SERVICE_UNAVAILABLE',
  message: 'Hệ thống tạm thời không sẵn sàng.',
} as const;

/** Ánh xạ lỗi HTTP đã biết của Nest sang mã hợp đồng (api.md §4.2). */
const HTTP_ERRORS: Record<number, { code: ErrorCode; message: string }> = {
  400: { code: 'E_GEN_VALIDATION_FAILED', message: 'Yêu cầu không hợp lệ.' },
  404: { code: 'E_GEN_NOT_FOUND', message: 'Không tìm thấy tài nguyên.' },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @InjectPinoLogger(AllExceptionsFilter.name) private readonly logger: ErrorLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const correlationId = resolveCorrelationId(request.headers['x-correlation-id'], this.ids);
    request.id = correlationId;
    request.headers['x-correlation-id'] = correlationId;
    reply.header('X-Trace-Id', correlationId);

    const path = requestPath(request.url);
    const classified = this.classify(exception, correlationId, path);
    if (classified.retryAfterSeconds !== undefined) {
      reply.header('Retry-After', String(classified.retryAfterSeconds));
    }
    const candidate: ErrorBody = {
      code: classified.code,
      message: classified.message,
      traceId: correlationId,
      timestamp: this.clock.now().toISOString(),
      path,
      ...(classified.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: classified.retryAfterSeconds }),
    };
    const parsed = errorBodySchema.safeParse(candidate);
    if (!parsed.success) {
      this.logger.error(
        { issues: parsed.error.issues, correlationId, path },
        'Body lỗi không khớp hợp đồng — trả lỗi hệ thống',
      );
      reply.status(500).send({
        ...UNAVAILABLE,
        traceId: correlationId,
        timestamp: candidate.timestamp,
        path,
      });
      return;
    }
    reply.status(classified.status).send(parsed.data);
  }

  /** Lỗi đã biết giữ mã/trạng thái; lỗi HTTP lạ và lỗi không lường trước quy về 500 đã che chi tiết. */
  private classify(
    exception: unknown,
    correlationId: string,
    path: string,
  ): { status: number; code: ErrorCode; message: string; retryAfterSeconds?: number } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        ...(exception.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: exception.retryAfterSeconds }),
      };
    }
    if (exception instanceof HttpException) {
      const mapped = HTTP_ERRORS[exception.getStatus()];
      if (mapped)
        return { status: exception.getStatus(), code: mapped.code, message: mapped.message };
      this.logger.error({ err: exception, correlationId, path }, 'Lỗi HTTP không ánh xạ được');
    } else {
      this.logger.error({ err: exception, correlationId, path }, 'Lỗi không lường trước');
    }
    return { status: 500, code: UNAVAILABLE.code, message: UNAVAILABLE.message };
  }
}
