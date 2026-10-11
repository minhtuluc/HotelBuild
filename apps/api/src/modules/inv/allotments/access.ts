import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AllotmentsService } from './service.js';
import { allotmentExpectedVersion } from './scope.js';
import { forbidden, writeInput } from './validation.js';
@Injectable()
export class AllotmentAccess implements IdempotencyAccess {
  constructor(@Inject(AllotmentsService) private readonly service: AllotmentsService) {}
  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isAuthorizedActor(request.actor) || !request.actor.hasPermission('allotments.write'))
      throw forbidden();
    allotmentExpectedVersion(request.headers['if-match']);
    await this.service.authorizedScope(this.service.db, request.actor, writeInput(request.body));
    return { type: 'USER' as const, id: request.actor.id };
  }
}
