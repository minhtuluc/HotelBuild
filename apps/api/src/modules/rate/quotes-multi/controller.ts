import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { QuotesMultiChannelService } from './service.js';

@Controller('quotes')
export class QuotesMultiChannelController {
  constructor(@Inject(QuotesMultiChannelService) readonly service: QuotesMultiChannelService) {}

  @Post('multi-channel')
  @Permission('quotes.multiChannel')
  @HttpCode(200)
  quote(@Body() body: unknown, @Req() request: FastifyRequest) {
    if (!isAuthorizedActor(request.actor))
      throw new AppError(401, 'E_AUTH_INVALID_CREDENTIALS', 'Chưa xác thực.');
    return this.service.quote(request.actor, body);
  }
}
