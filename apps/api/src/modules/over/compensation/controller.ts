/** `/room-moves/{id}/compensation-payments` (HB-125 AC13, F6-D06). */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { LocationInterceptor } from '../headers.js';
import { actorOf } from '../support.js';
import { CompensationAccess } from './access.js';
import { CompensationService } from './service.js';

@Controller('room-moves')
export class CompensationController {
  constructor(
    @Inject(CompensationService) private readonly service: CompensationService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Post(':id/compensation-payments')
  @Permission('over.compensation.pay')
  @Idempotent(CompensationAccess)
  @HttpCode(201)
  @UseInterceptors(
    new LocationInterceptor(
      (_request, body) =>
        `/api/v1/room-moves/${String(body.roomMoveId)}/compensation-payments/${String(body.id)}`,
    ),
  )
  pay(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    return this.service.pay(this.context.transaction(), actorOf(request), id, body, key);
  }

  @Get(':id/compensation-payments')
  @Permission('over.compensation.read')
  list(@Param('id') id: string, @Req() request: FastifyRequest) {
    return this.service.list(actorOf(request), id);
  }
}
