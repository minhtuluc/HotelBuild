import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { NoShowService } from './service.js';
import { noShowActor, noShowInput } from './validation.js';

/**
 * Tiền kiểm `@Idempotent` của `POST /front-office/no-show` (HB-029 README mục 1).
 *
 * Chủ thể + cú pháp + phạm vi cơ sở phải quyết được **trước** khi giữ khoá idempotency: lệnh hỏng hoặc
 * ngoài phạm vi không để lại `idempotency_keys` rác và không phát lại kết quả cho người khác (api.md
 * §1.6). Quyền `frontOffice.noShow` do `RbacGuard` kiểm theo decorator; ở đây chỉ còn cú pháp thân lệnh,
 * sự tồn tại của booking và phạm vi cơ sở (BR-RBAC-02/03).
 */
@Injectable()
export class NoShowAccess implements IdempotencyAccess {
  constructor(@Inject(NoShowService) private readonly service: NoShowService) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = noShowActor(request);
    const input = noShowInput(request.body);
    await this.service.authorizeFor(this.service.db, actor, input.bookingId);
    return { type: 'USER' as const, id: actor.id };
  }
}
