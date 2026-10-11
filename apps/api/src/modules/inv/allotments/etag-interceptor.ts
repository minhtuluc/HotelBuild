import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map, type Observable } from 'rxjs';
import { z } from 'zod';

/** Runs inside the idempotency interceptor so durable fresh/replay responses share the same ETag. */
@Injectable()
export class AllotmentETagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<undefined> {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((value: unknown) => {
        const etag = z
          .string()
          .regex(/^"[1-9]\d*"$/)
          .parse(value);
        reply.header('ETag', etag).header('Access-Control-Expose-Headers', 'ETag');
        return undefined;
      }),
    );
  }
}
