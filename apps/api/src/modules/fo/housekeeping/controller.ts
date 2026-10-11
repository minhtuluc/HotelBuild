import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { HousekeepingService } from './service.js';
import { HousekeepingAccess } from './access.js';
import { HousekeepingETagInterceptor } from './etag-interceptor.js';
import { requestActor, readQuery, updateInput, expectedVersion, taskId } from './validation.js';
@Controller('housekeeping/tasks')
export class HousekeepingController {
  constructor(
    @Inject(HousekeepingService) private readonly service: HousekeepingService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('housekeepingTasks.read')
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.list(requestActor(request), readQuery(query));
  }
  @Patch(':taskId')
  @Header('Cache-Control', 'no-store')
  @Permission('housekeepingTasks.update')
  @Idempotent(HousekeepingAccess)
  @UseInterceptors(HousekeepingETagInterceptor)
  update(
    @Param('taskId') id: unknown,
    @Body() body: unknown,
    @Headers('if-match') tag: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.update(
      this.context.transaction(),
      requestActor(request),
      taskId(id),
      updateInput(body),
      expectedVersion(tag),
    );
  }
}
