import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { ChannelsService } from './service.js';
@Controller('channels')
export class ChannelsController {
  constructor(@Inject(ChannelsService) readonly service: ChannelsService) {}
  @Get()
  @Permission('channels.read')
  list(
    @Req() request: FastifyRequest,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    if (!isAuthorizedActor(request.actor))
      throw new AppError(401, 'E_AUTH_INVALID_CREDENTIALS', 'Chưa xác thực.');
    response.header('cache-control', 'no-store');
    return this.service.list(request.actor, query);
  }
}
