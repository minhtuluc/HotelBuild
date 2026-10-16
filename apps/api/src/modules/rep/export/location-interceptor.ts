import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map } from 'rxjs';
import { operationRefSchema } from '@pinehill/contracts';

/**
 * api.md §6.4: lệnh trả 202 phải kèm `Location` của tài nguyên theo dõi.
 *
 * Không lấy `FastifyReply` bằng `@Res` được: `IdempotencyValidator` (HB-029) chặn tham số response trên
 * lệnh idempotent, nên header đặt trong interceptor — cùng cách `HousekeepingETagInterceptor`. Interceptor
 * chạy **trong** transaction idempotency nên `Location` được lưu và phát lại ở lần gọi lại cùng khoá.
 */
@Injectable()
export class ReportExportLocationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((value: unknown) => {
        const ref = operationRefSchema.parse(value);
        reply.header('Location', ref.statusUrl);
        return ref;
      }),
    );
  }
}
