import { Catch, HttpException, Inject } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ErrorBody, ErrorCode } from '@pinehill/contracts';
import type { Clock, IdGenerator } from '@pinehill/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CLOCK, ID_GENERATOR } from '../infrastructure/ports.js';
import { AppError } from './app-error.js';
import { resolveCorrelationId } from './request-id.js';

const HTTP_ERRORS: Record<number, { code: ErrorCode; message: string }> = {
  400: { code: 'E_GEN_VALIDATION_FAILED', message: 'Yêu cầu không hợp lệ.' },
  404: { code: 'E_GEN_NOT_FOUND', message: 'Không tìm thấy tài nguyên.' },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @InjectPinoLogger(AllExceptionsFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const correlationId = resolveCorrelationId(request.headers['x-correlation-id'], this.ids);
    request.id = correlationId;
    request.headers['x-correlation-id'] = correlationId;
    reply.header('X-Trace-Id', correlationId);
    let status: number;
    let code: ErrorCode;
    let message: string;
    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      const mapped = HTTP_ERRORS[exception.getStatus()];
      status = mapped ? exception.getStatus() : 500;
      code = mapped ? mapped.code : 'E_GEN_SERVICE_UNAVAILABLE';
      message = mapped ? mapped.message : 'Hệ thống tạm thời không sẵn sàng.';
      if (!mapped) {
        this.logger.error(
          { err: exception, correlationId, path: request.url },
          'Lỗi HTTP không ánh xạ được',
        );
      }
    } else {
      status = 500;
      code = 'E_GEN_SERVICE_UNAVAILABLE';
      message = 'Hệ thống tạm thời không sẵn sàng.';
      this.logger.error(
        { err: exception, correlationId, path: request.url },
        'Lỗi không lường trước',
      );
    }
    const body: ErrorBody = {
      code,
      message,
      traceId: correlationId,
      timestamp: this.clock.now().toISOString(),
      path: request.url,
    };
    reply.status(status).send(body);
  }
}
