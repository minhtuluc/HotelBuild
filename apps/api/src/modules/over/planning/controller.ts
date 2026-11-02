/**
 * `POST /overbooking-cases/{id}/relocation-plan|resolve` và
 * `GET /bookings/{id}/relocation-options` (HB-125; api.md §3.9–3.10).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { actorOf } from '../support.js';
import { OverbookingResolveAccess, RelocationPlanAccess } from './access.js';
import { RelocationOptionsService } from './options.js';
import { OverbookingPlanningService } from './service.js';

@Controller('overbooking-cases')
export class OverbookingPlanningController {
  constructor(
    @Inject(OverbookingPlanningService) private readonly service: OverbookingPlanningService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Post(':id/relocation-plan')
  @Permission('over.plan')
  @Idempotent(RelocationPlanAccess)
  @HttpCode(200)
  plan(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.plan(this.context.transaction(), actorOf(request), id, body);
  }

  @Post(':id/resolve')
  @Permission('over.resolve')
  @Idempotent(OverbookingResolveAccess)
  @HttpCode(200)
  resolve(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.resolve(this.context.transaction(), actorOf(request), id, body);
  }
}

@Controller('bookings')
export class RelocationOptionsController {
  constructor(
    @Inject(RelocationOptionsService) private readonly service: RelocationOptionsService,
  ) {}

  @Get(':id/relocation-options')
  @Permission('over.options.read')
  async options(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.service.read(actorOf(request), id, query);
    reply
      .header('ETag', result.etag)
      .header('Cache-Control', 'no-store')
      .header('Access-Control-Expose-Headers', 'ETag');
    return result.body;
  }
}
