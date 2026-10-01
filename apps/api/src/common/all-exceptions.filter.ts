import { Catch, Inject } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ErrorBody } from '@pinehill/contracts';
import type { Clock } from '@pinehill/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CLOCK } from '../infrastructure/ports.js';
import { AppError } from './app-error.js';

/**
 * Mọi exception → body khớp `errorBodySchema` (api.md §4.1).
 * Lỗi đã biết (`AppError`) giữ mã/trạng thái; lỗi lạ → 500 `E_GEN_SERVICE_UNAVAILABLE`,
 * ghi stack vào log nhưng không lộ message nội bộ ra response.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @InjectPinoLogger(AllExceptionsFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    let status: number;
    let code: string;
    let message: string;
    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
    } else {
      status = 500;
      code = 'E_GEN_SERVICE_UNAVAILABLE';
      message = 'Hệ thống tạm thời không sẵn sàng.';
      this.logger.error(
        { err: exception, correlationId: request.id, path: request.url },
        'Lỗi không lường trước',
      );
    }

    const body: ErrorBody = {
      code,
      message,
      traceId: request.id,
      timestamp: this.clock.now().toISOString(),
      path: request.url,
    };
    reply.status(status).send(body);
  }
}
