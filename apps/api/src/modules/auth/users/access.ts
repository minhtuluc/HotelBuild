import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { UsersService } from './service.js';
import { accessInput, expectedVersion, pathUserId, requestActor } from './validation.js';

/**
 * Tiền kiểm của `PUT /users/{id}/access` trước claim idempotency (README idempotency mục 1): `If-Match`
 * (thiếu ⇒ 428), thân lệnh (400), đích tồn tại (404) và luật gán (403). Phần khoá/version/OWNER cuối nằm
 * trong `UsersService.update`, chạy trong transaction của claim.
 */
@Injectable()
export class UsersAccess implements IdempotencyAccess {
  constructor(@Inject(UsersService) private readonly service: UsersService) {}
  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = requestActor(request);
    expectedVersion(request.headers['if-match']);
    const input = accessInput(request.body);
    const params: unknown = request.params;
    const userId =
      typeof params === 'object' && params !== null && 'userId' in params
        ? params.userId
        : undefined;
    await this.service.authorize(this.service.db, actor, pathUserId(userId), input);
    return { type: 'USER' as const, id: actor.id };
  }
}
