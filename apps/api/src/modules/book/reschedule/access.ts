/**
 * Tiền kiểm trước khi giữ khoá chống trùng (HB-029): chủ thể, cú pháp lệnh và quyền trên tài nguyên phải
 * xác định được **trước**, nên lệnh hỏng/ngoài quyền không để lại hàng `idempotency_keys` rác và không
 * phát lại kết quả cho người khác (api.md §1.6: "kiểm tra quyền hiện tại trước phát lại"). Cùng cách
 * `CancelAccess` (HB-097) và `BookingAccess` (HB-077).
 *
 * Cú pháp được kiểm **trước** tài nguyên: bộ oracle RBAC (`test/rbac/registered-routes.spec.ts`) gửi
 * thân sai nên hai tuyến phải trả `400` trước khi tra booking, còn `:bookingId` hợp lệ mà không có hàng
 * ⇒ `404` (không lộ sự tồn tại tài nguyên người khác).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { cancelCaller } from '../cancel/caller.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { RescheduleService } from './service.js';
import { bookingParam, deleteReason, requestActor, rescheduleInput } from './validation.js';

@Injectable()
export class RescheduleAccess implements IdempotencyAccess {
  constructor(
    @Inject(RescheduleService) private readonly service: RescheduleService,
    @Inject(PRISMA) readonly db: PrismaClient,
    @Inject(CONFIG) readonly config: ApiConfig,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(PermissionRegistry) readonly permissions: PermissionRegistry,
  ) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    // HB-258: khách hoặc nhân viên; khoá chống trùng gắn đúng chủ thể.
    const actor = await cancelCaller(this, request, 'bookings.reschedule');
    const bookingId = bookingParam(request.params);
    rescheduleInput(request.body);
    await this.service.authorizeFor(this.service.db, actor, bookingId);
    return { type: actor.kind, id: actor.id };
  }
}

@Injectable()
export class HardDeleteAccess implements IdempotencyAccess {
  constructor(@Inject(RescheduleService) private readonly service: RescheduleService) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = requestActor(request);
    const bookingId = bookingParam(request.params);
    deleteReason(request.query);
    await this.service.authorizeForDelete(this.service.db, actor, bookingId);
    return { type: 'USER', id: actor.id };
  }
}
