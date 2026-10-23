import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HousekeepingService } from './service.js';
import { createInput, expectedVersion, requestActor, taskId, updateInput } from './validation.js';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
@Injectable()
export class HousekeepingAccess implements IdempotencyAccess {
  constructor(@Inject(HousekeepingService) private readonly service: HousekeepingService) {}
  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = requestActor(request);
    // Do not compare with current version here: a replay must return its original result.
    expectedVersion(request.headers['if-match']);
    const params = z.object({ taskId: z.unknown() }).parse(request.params);
    const id = taskId(params.taskId),
      input = updateInput(request.body);
    await this.service.authorize(this.service.db, actor, id, input);
    return { type: 'USER' as const, id: actor.id };
  }
}

/** Quyền cho `POST /housekeeping/tasks`: kiểm vai trò + phạm vi phòng trước khi nhận khoá idempotency. */
@Injectable()
export class HousekeepingCreateAccess implements IdempotencyAccess {
  constructor(@Inject(HousekeepingService) private readonly service: HousekeepingService) {}
  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = requestActor(request);
    await this.service.authorizeCreate(this.service.db, actor, createInput(request.body));
    return { type: 'USER' as const, id: actor.id };
  }
}
