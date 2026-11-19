import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@pinehill/domain';
import { z } from 'zod';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { cancelCaller } from './caller.js';
import { CancelService } from './service.js';
import { bookingId, cancelInput } from './validation.js';

@Injectable()
export class CancelAccess implements IdempotencyAccess {
  constructor(
    @Inject(CancelService) private readonly service: CancelService,
    @Inject(PRISMA) readonly db: PrismaClient,
    @Inject(CONFIG) readonly config: ApiConfig,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(PermissionRegistry) readonly permissions: PermissionRegistry,
  ) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = await cancelCaller(this, request, 'bookings.cancel');
    // Kiểm tra cú pháp trước khi khoá chống trùng: body sai → 400, replay không ăn body khác.
    const params = z.object({ bookingId: z.unknown() }).parse(request.params);
    const id = bookingId(params.bookingId);
    cancelInput(request.body);
    await this.service.authorizeFor(this.service.db, actor, id);
    // Khoá chống trùng theo đúng chủ thể: khách và nhân viên không bao giờ phát lại kết quả của nhau.
    return { type: actor.kind, id: actor.id };
  }
}
