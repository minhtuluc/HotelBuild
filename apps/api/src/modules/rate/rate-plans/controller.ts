import { Body, Controller, Get, HttpCode, Inject, Param, Put, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Public } from '../../../common/guards/decorators.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { RatePlansService } from './service.js';
import { RatePlanAccess } from './access.js';
import { publicQuery } from './validation.js';
import { requestOwner, expectedVersion, uuid, invalid, pageQuery } from './support.js';
@Controller('rate-plans')
export class RatePlansController {
  constructor(
    @Inject(RatePlansService) readonly service: RatePlansService,
    @Inject(IdempotencyContext) readonly context: IdempotencyContext,
  ) {}
  @Public()
  @Get()
  list(@Query() value: unknown) {
    const p = publicQuery.safeParse(value);
    if (!p.success) throw invalid();
    return this.service.listPublic(p.data);
  }
  @Permission('ratePlans.admin')
  @Get('admin')
  admin(@Query() value: unknown, @Req() request: FastifyRequest) {
    const p = pageQuery.safeParse(value);
    if (!p.success) throw invalid();
    return this.service.listAdmin(requestOwner(request), p.data);
  }
  @Permission('ratePlans.update')
  @Idempotent(RatePlanAccess)
  @Put(':ratePlanId')
  @HttpCode(204)
  async update(
    @Param('ratePlanId') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    await this.service.update(
      this.context.transaction(),
      requestOwner(request),
      uuid(id),
      expectedVersion(request.headers['if-match']),
      body,
    );
  }
}
