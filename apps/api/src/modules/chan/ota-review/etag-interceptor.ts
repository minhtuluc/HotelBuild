import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map, type Observable } from 'rxjs';
import { z } from 'zod';
import { etagOf } from './validation.js';

/**
 * ETag của lệnh soát trùng là **version booking sau khi ghi**, nhưng tuyến chống trùng cấm dùng
 * `@Res()` (IdempotencyValidator). Interceptor này chạy bên trong interceptor chống trùng nên cả
 * phản hồi mới lẫn phản hồi phát lại đều mang cùng ETag và cùng thân JSON.
 */
@Injectable()
export class OtaReviewETagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((value: unknown) => {
        const version = z.object({ version: z.number().int().positive() }).parse(value).version;
        reply
          .header('ETag', etagOf(BigInt(version)))
          .header('Access-Control-Expose-Headers', 'ETag');
        return value;
      }),
    );
  }
}
