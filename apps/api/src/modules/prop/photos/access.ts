import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { expectedEtag, forbidden, replaceInput } from './support.js';

/** Tiền kiểm trước khi giữ khoá idempotency: OWNER, `If-Match` (428) và thân hợp lệ. */
@Injectable()
export class PhotoReplaceAccess implements IdempotencyAccess {
  authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isAuthorizedActor(request.actor) || request.actor.role !== 'OWNER') throw forbidden();
    expectedEtag(request.headers['if-match']);
    replaceInput(request.body);
    return Promise.resolve({ type: 'USER' as const, id: request.actor.id });
  }
}
