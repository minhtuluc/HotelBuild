/**
 * `201`/`200` + `Location` của `POST /walk-in` (HB-151).
 *
 * Cùng lý do với `BookingCreatedInterceptor` (HB-077): `IdempotencyValidator` (HB-029) cấm tham số
 * response trên lệnh idempotent nên trạng thái/header đặt trong interceptor. Interceptor chạy **trong**
 * transaction idempotency nên `Location` và trạng thái được lưu rồi phát lại y nguyên ở lần gọi lại.
 *
 * `created = false` là nhánh BR-BOOK-16 (trả booking đã có kèm `duplicateSuspected`) ⇒ `200`, không phải
 * `201` — cùng quy ước `POST /bookings` và `POST /guests`.
 */
import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map } from 'rxjs';
import { walkInResultSchema } from '@pinehill/contracts';

@Injectable()
export class WalkInCreatedInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((value: unknown) => {
        const result = walkInResultSchema.parse(value);
        reply.status(result.created ? 201 : 200);
        reply.header('Location', `/api/v1/bookings/${result.booking.id}`);
        return result;
      }),
    );
  }
}
