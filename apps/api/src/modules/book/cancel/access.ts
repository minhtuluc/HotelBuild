import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CancelService } from './service.js';
import { bookingId, cancelInput, requestActor } from './validation.js';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';

@Injectable()
export class CancelAccess implements IdempotencyAccess {
  constructor(@Inject(CancelService) private readonly service: CancelService) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = requestActor(request);
    // Kiểm tra cú pháp trước khi khoá chống trùng: body sai → 400, replay không ăn body khác.
    const params = z.object({ bookingId: z.unknown() }).parse(request.params);
    const id = bookingId(params.bookingId);
    cancelInput(request.body);
    await this.service.authorizeFor(this.service.db, actor, id);
    return { type: 'USER' as const, id: actor.id };
  }
}
