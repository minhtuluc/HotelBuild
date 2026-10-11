import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  HttpCode,
  Inject,
  Put,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { AllotmentsService } from './service.js';
import { AllotmentAccess } from './access.js';
import { AllotmentETagInterceptor } from './etag-interceptor.js';
import { allotmentExpectedVersion } from './scope.js';
import { forbidden, readInput, writeInput } from './validation.js';
const actor = (request: FastifyRequest) => {
  if (!isAuthorizedActor(request.actor)) throw forbidden();
  return request.actor;
};
@Controller('channel-allotments')
export class AllotmentsController {
  constructor(
    @Inject(AllotmentsService) private readonly service: AllotmentsService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}
  @Get()
  @Permission('allotments.read')
  async list(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.service.list(actor(request), readInput(query));
    reply
      .header('ETag', result.etag)
      .header('Cache-Control', 'no-store')
      .header('Access-Control-Expose-Headers', 'ETag');
    return result.body;
  }
  @Put()
  @HttpCode(204)
  @Header('Access-Control-Expose-Headers', 'ETag')
  @Permission('allotments.write')
  @Idempotent(AllotmentAccess)
  @UseInterceptors(AllotmentETagInterceptor)
  async put(
    @Body() body: unknown,
    @Headers('if-match') tag: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.put(
      this.context.transaction(),
      actor(request),
      writeInput(body),
      allotmentExpectedVersion(tag),
    );
  }
}
