import { z } from 'zod';
import { Body, Controller, Get, Inject, Param, Put, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { CancellationPoliciesService } from './service.js';
import { CancellationPolicyAccess } from './access.js';
import { requestOwner, expectedVersion, uuid, invalid, pageQuery } from '../rate-plans/support.js';
const query = pageQuery.extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
@Controller('cancellation-policies')
export class CancellationPoliciesController {
  constructor(
    @Inject(CancellationPoliciesService) readonly service: CancellationPoliciesService,
    @Inject(IdempotencyContext) readonly context: IdempotencyContext,
  ) {}
  @Permission('cancellationPolicies.read')
  @Get()
  list(@Query() value: unknown, @Req() request: FastifyRequest) {
    const p = query.safeParse(value);
    if (!p.success) throw invalid();
    return this.service.list(requestOwner(request), p.data);
  }
  @Permission('cancellationPolicies.update')
  @Idempotent(CancellationPolicyAccess)
  @Put(':policyId')
  update(@Param('policyId') id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.update(
      this.context.transaction(),
      requestOwner(request),
      uuid(id),
      expectedVersion(request.headers['if-match']),
      body,
    );
  }
}
