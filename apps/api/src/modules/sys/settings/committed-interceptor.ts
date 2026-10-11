import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap, type Observable } from 'rxjs';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { RUNTIME_SETTINGS, type RuntimeSettings } from './runtime-port.js';
/** Must wrap IdempotencyInterceptor: successful emission means its DB transaction has committed. */
@Injectable()
export class SettingsCommittedInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RUNTIME_SETTINGS) private readonly cache: RuntimeSettings,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>('SYS_SETTING_COMMITTED', context.getHandler()))
      return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const params = z.object({ key: z.string() }).parse(request.params);
    // Evict on both fresh success and replay; never populate from an older replay response.
    return next.handle().pipe(tap(() => this.cache.invalidate(params.key)));
  }
}
