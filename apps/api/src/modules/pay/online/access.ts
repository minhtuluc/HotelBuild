/**
 * Tiền kiểm trước khi giữ khoá idempotency (HB-029): chủ thể, cú pháp lệnh và quyền trên tài nguyên phải
 * xác định **trước**, nên lệnh hỏng/ngoài quyền không để lại `idempotency_keys` rác và không phát lại
 * kết quả cho người khác (api.md §1.6: "kiểm tra quyền hiện tại trước phát lại").
 *
 * Dùng đúng `bookingCaller` mà controller/handler dùng, và cùng luật `requireOnlinePayment` — nên bước
 * tiền kiểm và bước thi hành không thể lệch nhau. Truy vấn ở đây chỉ để **kiểm quyền**; số tiền/hạn vẫn
 * được đọc lại sau khoá trong transaction nghiệp vụ của use case.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { bookingCaller } from '../../book/bookings/principal.js';
import { requireOnlinePayment } from './principal.js';
import { missing, onlinePaymentInput } from './validation.js';

@Injectable()
export class OnlinePaymentAccess implements IdempotencyAccess {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PermissionRegistry) private readonly permissions: PermissionRegistry,
  ) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const caller = await bookingCaller(this.db, request, this.config, this.clock);
    const input = onlinePaymentInput(request.body);
    const target = await this.db.bookings.findUnique({
      where: { id: input.bookingId },
      select: { guest_id: true, property_id: true },
    });
    if (target === null) throw missing();
    requireOnlinePayment(this.permissions, caller, {
      guestId: target.guest_id,
      propertyId: target.property_id,
    });
    return caller.principal;
  }
}
