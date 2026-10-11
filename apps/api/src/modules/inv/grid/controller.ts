import { Controller, Get, Header, Inject, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { forbidden } from '../allotments/validation.js';
import { GridService } from './service.js';
import { gridInput } from './validation.js';
@Controller('inventory/grid')
export class GridController {
  constructor(@Inject(GridService) private readonly service: GridService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('inventory.grid')
  async get(@Query() query: unknown, @Req() request: FastifyRequest) {
    if (!isAuthorizedActor(request.actor)) throw forbidden();
    return this.service.get(request.actor, gridInput(query));
  }
}
