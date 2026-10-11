import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { actor } from './validation.js';
import { expectedVersion, input, key } from './command-input.js';
import { SettingsService } from './service.js';
@Injectable()
export class SettingsAccess implements IdempotencyAccess {
  constructor(@Inject(SettingsService) private readonly service: SettingsService) {}
  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const current = actor(request);
    expectedVersion(request.headers['if-match']);
    const params = z.object({ key: z.unknown() }).parse(request.params);
    await this.service.authorize(this.service.db, current, key(params.key), input(request.body));
    return { type: 'USER' as const, id: current.id };
  }
}
