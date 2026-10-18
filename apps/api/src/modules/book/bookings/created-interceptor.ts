/**
 * `Location` + trạng thái của `POST /bookings` (api.md §3.2: `201` kèm `Location: /api/v1/bookings/{id}`).
 *
 * Không lấy `FastifyReply` bằng `@Res` được: `IdempotencyValidator` (HB-029) chặn tham số response trên
 * lệnh idempotent, nên header/trạng thái đặt trong interceptor — cùng cách
 * `ReportExportLocationInterceptor` (HB-163) và `AllotmentETagInterceptor` (HB-035). Interceptor chạy
 * **trong** transaction idempotency nên `Location` và trạng thái được lưu và phát lại y nguyên ở lần gọi
 * lại cùng khoá.
 *
 * `created = false` là nhánh BR-BOOK-16 (trả booking đã có kèm `duplicateSuspected`) ⇒ `200`, không phải
 * `201`. Hợp đồng phát hành chỉ khai `201` cho đường này — giống `POST /guests` (HB-149) cũng trả `200`
 * khi SĐT đã có hồ sơ.
 */
import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map } from 'rxjs';
import { bookingSummarySchema } from '@pinehill/contracts';
import { z } from 'zod';

const createdSchema = z.object({ created: z.boolean(), booking: bookingSummarySchema });

@Injectable()
export class BookingCreatedInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((value: unknown) => {
        const result = createdSchema.parse(value);
        reply.status(result.created ? 201 : 200);
        reply.header('Location', `/api/v1/bookings/${result.booking.id}`);
        return result.booking;
      }),
    );
  }
}
