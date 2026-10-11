import { Controller, Get, Header, Inject, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { actor } from '../settings/validation.js';
import { AuditLogsService } from './service.js';
@Controller('audit-logs')
export class AuditLogsController {
  constructor(@Inject(AuditLogsService) private readonly service: AuditLogsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('auditLogs.read')
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.list(actor(request), query);
  }
}
