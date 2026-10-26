import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map } from 'rxjs';
import { userSummarySchema } from '@pinehill/contracts';

/** Chạy bên trong interceptor idempotency nên lần phát lại cũng trả đúng ETag đã lưu. */
@Injectable()
export class UserETagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((value: unknown) => {
        const user = userSummarySchema.parse(value);
        reply.header('ETag', `"${user.version}"`).header('Access-Control-Expose-Headers', 'ETag');
        return user;
      }),
    );
  }
}
