/**
 * Tiền kiểm trước khi giữ khoá idempotency (HB-029): chủ thể, cú pháp lệnh và quyền trên tài nguyên
 * phải xác định được trước, nên lệnh hỏng/ngoài quyền không để lại `idempotency_keys` rác và không
 * phát lại kết quả cho người khác (api.md §1.6: "kiểm tra quyền hiện tại trước phát lại").
 *
 * Chủ thể phân giải **đúng như** `HoldsController` dùng (`principal.ts`): token hỏng ⇒ 401 trước khi
 * chạm tới store; `POST /holds` chỉ nhận phiên khách (api.md §2.5); `DELETE` kiểm quyền trên chính
 * hold sắp giải phóng.
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
import { holdCaller, requireGuest, requireHoldAccess } from './principal.js';
import { invalid, missing, holdInput, releaseReason } from './validation.js';
import { uuid } from '../../rate/calendar/support.js';

@Injectable()
export class HoldAccess implements IdempotencyAccess {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PermissionRegistry) private readonly permissions: PermissionRegistry,
  ) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const caller = await holdCaller(this.db, request, this.config, this.clock);
    if (request.method === 'POST') {
      holdInput(request.body);
      requireGuest(caller);
      return caller.principal;
    }
    const params = z.object({ holdId: z.unknown() }).safeParse(request.params);
    if (!params.success) throw invalid();
    const id = uuid(params.data.holdId);
    releaseReason(request.query);
    const booking = await this.db.bookings.findUnique({
      where: { id },
      select: { guest_id: true, property_id: true },
    });
    if (booking === null) throw missing();
    requireHoldAccess(this.permissions, caller, {
      guestId: booking.guest_id,
      propertyId: booking.property_id,
    });
    return caller.principal;
  }
}
