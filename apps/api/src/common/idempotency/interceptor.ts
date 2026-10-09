import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { ContextIdFactory, ModuleRef, Reflector } from '@nestjs/core';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { defer, lastValueFrom } from 'rxjs';
import type { Observable } from 'rxjs';
import { IDEMPOTENT } from './decorators.js';
import type { IdempotencyAccess } from './decorators.js';
import type { Type } from '@nestjs/common';
import { IdempotencyContext } from './context.js';
import { IdempotencyStore } from './store.js';
import type { CommandResponse } from './store.js';
import { identifyRequest } from './request.js';
import { normalizeResponse } from './response.js';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ModuleRef) private readonly modules: ModuleRef,
    @Inject(IdempotencyStore) private readonly store: IdempotencyStore,
    @Inject(IdempotencyContext) private readonly transactionContext: IdempotencyContext,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const accessType = this.reflector.get<Type<IdempotencyAccess> | undefined>(
      IDEMPOTENT,
      context.getHandler(),
    );
    if (!accessType) return next.handle();
    return defer(async () => {
      const reply = context.switchToHttp().getResponse<FastifyReply>();
      try {
        return await this.command(context, next, accessType);
      } catch (error) {
        // Remove unsafe controller headers before the exception filter writes its JSON error.
        for (const name of Object.keys(reply.getHeaders()))
          if (name.toLowerCase() !== 'x-trace-id') reply.removeHeader(name);
        throw error;
      }
    });
  }
  private async command(
    context: ExecutionContext,
    next: CallHandler,
    accessType: Type<IdempotencyAccess>,
  ): Promise<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const access = await this.modules.resolve(accessType, ContextIdFactory.getByRequest(request), {
      strict: false,
    });
    const principal = await access.authorize(context);
    const identity = identifyRequest(principal, request);
    const result = await this.store.claim(identity);
    if (result.kind === 'replay') {
      const replay = normalizeResponse(result.response.status, result.response.body, {
        ...reply.getHeaders(),
        ...result.response.headers,
      });
      reply.header('Idempotency-Replayed', 'true');
      return this.jsonResponse(reply, replay);
    }
    if (!reply.hasHeader('content-type'))
      reply.header('Content-Type', 'application/json; charset=utf-8');
    const response = await this.store.run(result, (tx) =>
      this.transactionContext.run(tx, async () => {
        const body: unknown = await lastValueFrom(next.handle());
        return normalizeResponse(reply.statusCode, body, reply.getHeaders());
      }),
    );
    return this.jsonResponse(reply, response);
  }
  private jsonResponse(reply: FastifyReply, response: CommandResponse): unknown {
    reply.status(response.status);
    for (const [name, value] of Object.entries(response.headers)) reply.header(name, value);
    // Fastify sends strings verbatim; quote a JSON string scalar on both fresh and replay paths.
    return typeof response.body === 'string' ? JSON.stringify(response.body) : response.body;
  }
}
