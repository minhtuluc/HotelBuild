/**
 * `Location` của lệnh tạo (api.md §1.3). HB-029 cấm handler `@Idempotent` tự ghi response
 * (`@Res`), nên header được đặt bằng interceptor **bên trong** transaction để lần replay cùng khoá
 * phát lại đúng `Location` đã lưu.
 */
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { tap } from 'rxjs';
import { z } from 'zod';

export type LocationBuilder = (request: FastifyRequest, body: Record<string, unknown>) => string;

/** Chỉ cần `id` để dựng `Location`; trường khác của thân lệnh vẫn được giữ cho builder dùng. */
const createdBodySchema = z.looseObject({ id: z.string().min(1) });

export class LocationInterceptor<T> implements NestInterceptor<T, T> {
  constructor(private readonly build: LocationBuilder) {}

  intercept(context: ExecutionContext, next: CallHandler<T>) {
    return next.handle().pipe(
      tap((body: T) => {
        const parsed = createdBodySchema.safeParse(body);
        if (!parsed.success) return;
        const reply = context.switchToHttp().getResponse<FastifyReply>();
        reply.header(
          'Location',
          this.build(context.switchToHttp().getRequest<FastifyRequest>(), parsed.data),
        );
      }),
    );
  }
}
