import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map, type Observable } from 'rxjs';
import { operationRefSchema } from '@pinehill/contracts';

/**
 * api.md §6.4 — lệnh 202 của CHAN kèm `Location` của hàng `operations` theo dõi.
 *
 * Không đặt header ở controller: lệnh idempotent không được nhận tham số response (HB-029), và
 * interceptor chạy **trong** transaction của khoá nên `Location` được lưu lại rồi phát lại nguyên vẹn khi
 * client gọi lại cùng `Idempotency-Key`.
 */
@Injectable()
export class ChannelOperationLocationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
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
