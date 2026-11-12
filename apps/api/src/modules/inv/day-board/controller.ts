import { Controller, Get, Header, Inject, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { forbidden } from '../allotments/validation.js';
import { DayBoardService } from './service.js';
import { dayBoardInput } from './validation.js';

@Controller('operations/day-board')
export class DayBoardController {
  constructor(@Inject(DayBoardService) private readonly service: DayBoardService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('operations.dayBoard')
  async get(@Query() query: unknown, @Req() request: FastifyRequest) {
    if (!isAuthorizedActor(request.actor)) throw forbidden();
    return this.service.get(request.actor, dayBoardInput(query));
  }
}
