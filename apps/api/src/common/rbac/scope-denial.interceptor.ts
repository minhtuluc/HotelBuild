import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { InjectPinoLogger } from 'nestjs-pino';
import { catchError, throwError } from 'rxjs';
import { ScopeDeniedError } from './scope.js';

@Injectable()
export class ScopeDenialInterceptor implements NestInterceptor {
  constructor(
    @InjectPinoLogger(ScopeDenialInterceptor.name)
    private readonly logger: { warn(context: Record<string, unknown>, message: string): void },
  ) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof ScopeDeniedError) {
          const request = context.switchToHttp().getRequest<FastifyRequest>();
          this.logger.warn(
            { event: 'RBAC_DENIED', reason: 'SCOPE', correlationId: request.actor?.correlationId },
            'Access denied',
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
