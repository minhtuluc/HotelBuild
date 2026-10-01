import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { IdGenerator } from '@pinehill/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { ID_GENERATOR } from '../infrastructure/ports.js';

/** Nhận/ sinh mã tương quan, trả lại ở X-Trace-Id và gắn vào request (api.md §1.3). */
@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  constructor(@Inject(ID_GENERATOR) private readonly ids: IdGenerator) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const incoming = request.headers['x-correlation-id'];
    const correlationId =
      typeof incoming === 'string' && incoming.length > 0 ? incoming : this.ids.generate();
    request.id = correlationId;
    request.headers['x-correlation-id'] = correlationId;
    reply.header('X-Trace-Id', correlationId);
    return next.handle();
  }
}
