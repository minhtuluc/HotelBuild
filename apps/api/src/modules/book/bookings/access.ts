/**
 * Tiền kiểm trước khi giữ khoá idempotency (HB-029): chủ thể, cú pháp lệnh và quyền trên tài nguyên
 * phải xác định được trước, nên lệnh hỏng/ngoài quyền không để lại `idempotency_keys` rác và không
 * phát lại kết quả cho người khác (api.md §1.6: "kiểm tra quyền hiện tại trước phát lại").
 *
 * Phân nhánh theo tham số đường dẫn: có `:bookingId` là `POST /bookings/{bookingId}/confirm` (kiểm
 * **thân lệnh trước** — bộ oracle RBAC của `test/rbac/registered-routes.spec.ts` gửi thân sai nên phải
 * nhận `400` trước khi tra tài nguyên — rồi quyền `bookings.confirm` trên chính booking đó); không có
 * là `POST /bookings` (tiêu kiểm `bookings.create` trong cơ sở của lệnh).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import { z } from 'zod';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { bookingCaller, requireConfirm, requireCreate } from './principal.js';
import { bookingId, bookingInput, confirmInput, missing } from './validation.js';

@Injectable()
export class BookingAccess implements IdempotencyAccess {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PermissionRegistry) private readonly permissions: PermissionRegistry,
  ) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const caller = await bookingCaller(this.db, request, this.config, this.clock);
    const params = z.object({ bookingId: z.unknown() }).safeParse(request.params);
    if (params.success && params.data.bookingId !== undefined) {
      confirmInput(request.body);
      const id = bookingId(params.data.bookingId);
      const booking = await this.db.bookings.findUnique({
        where: { id },
        select: { property_id: true },
      });
      if (booking === null) throw missing();
      requireConfirm(this.permissions, caller, { propertyId: booking.property_id });
      return caller.principal;
    }
    const input = bookingInput(request.body);
    requireCreate(this.permissions, caller, input.propertyId);
    return caller.principal;
  }
}
