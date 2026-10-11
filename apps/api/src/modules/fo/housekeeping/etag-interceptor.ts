import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map } from 'rxjs';
import { housekeepingTaskSchema } from '@pinehill/contracts';
/** Inside idempotency transaction, so a replay returns the original response and ETag. */
@Injectable()
export class HousekeepingETagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((value: unknown) => {
        const task = housekeepingTaskSchema.parse(value);
        reply.header('ETag', `"${task.version}"`).header('Access-Control-Expose-Headers', 'ETag');
        return task;
      }),
    );
  }
}
