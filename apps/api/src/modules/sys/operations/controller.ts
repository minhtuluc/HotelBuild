import { Controller, Get, Header, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { actor } from '../../sys/settings/validation.js';
import { OperationsService } from './service.js';
import { operationId } from './validation.js';

/** api.md §2.12 — theo dõi thao tác bất đồng bộ và tải tệp xuất (link ký, hạn ngắn). */
@Controller('operations')
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly service: OperationsService) {}

  @Get(':operationId')
  @Header('Cache-Control', 'no-store')
  @Permission('operations.read')
  status(@Param('operationId') id: string, @Req() request: FastifyRequest) {
    return this.service.status(actor(request), operationId(id));
  }

  @Get(':operationId/download')
  @Permission('operations.download')
  async download(
    @Param('operationId') id: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const artifact = await this.service.download(actor(request), operationId(id), query);
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Type', artifact.contentType);
    reply.header('Content-Disposition', `attachment; filename="${artifact.fileName}"`);
    await reply.send(createReadStream(artifact.path));
  }
}
