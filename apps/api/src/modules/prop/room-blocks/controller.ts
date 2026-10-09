import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { RoomBlocksService } from './service.js';
import { RoomBlockAccess } from './access.js';
import { createInput, deleteReason, forbidden, invalid, listInput, uuid } from './validation.js';
const actor = (request: FastifyRequest) => {
  if (!isAuthorizedActor(request.actor)) throw forbidden();
  return request.actor;
};
@Controller('room-blocks')
export class RoomBlocksController {
  constructor(
    @Inject(RoomBlocksService) private readonly service: RoomBlocksService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}
  @Permission('roomBlocks.create')
  @Idempotent(RoomBlockAccess)
  @Post()
  @HttpCode(201)
  create(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.create(this.context.transaction(), actor(request), createInput(body));
  }
  @Permission('roomBlocks.remove')
  @Idempotent(RoomBlockAccess)
  @Delete(':roomBlockId')
  @HttpCode(204)
  async remove(
    @Param('roomBlockId') id: string,
    @Query('reason') reason: unknown,
    @Req() request: FastifyRequest,
  ) {
    await this.service.remove(
      this.context.transaction(),
      actor(request),
      uuid(id),
      deleteReason(reason),
    );
  }
  @Permission('roomBlocks.read')
  @Get()
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    const input = listInput.safeParse(query);
    if (!input.success) throw invalid();
    return this.service.list(actor(request), input.data);
  }
}
