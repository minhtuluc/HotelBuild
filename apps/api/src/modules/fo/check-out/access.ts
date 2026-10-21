import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { CheckOutService } from './service.js';
import { checkOutInput, requestActor } from './validation.js';

/**
 * Kiểm cú pháp thân lệnh và phạm vi cơ sở **trước** khi giữ khoá chống trùng (như HB-097):
 * body sai ⇒ 400, booking ngoài phạm vi ⇒ 403. PIN chỉ được tiêu thụ trong transaction nghiệp vụ
 * nên lỗi PIN không bao giờ tạo khoá `COMPLETED` giả.
 */
@Injectable()
export class CheckOutAccess implements IdempotencyAccess {
  constructor(@Inject(CheckOutService) private readonly service: CheckOutService) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = requestActor(request);
    const input = checkOutInput(request.body);
    await this.service.authorizeFor(this.service.db, actor, input.bookingId);
    return { type: 'USER' as const, id: actor.id };
  }
}
