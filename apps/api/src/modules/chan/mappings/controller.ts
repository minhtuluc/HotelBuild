import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Put,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { actor } from '../../sys/settings/validation.js';
import { channelIdParam } from '../sync/validation.js';
import { ChannelMappingAccess } from './access.js';
import { ChannelMappingsETagInterceptor } from './etag-interceptor.js';
import { ChannelMappingsService } from './service.js';
import { expectedChannelVersion, mappingInput } from './validation.js';

/**
 * api.md §2.7 — `PUT /channels/{channelId}/mappings` (OWNER) là lệnh sửa cấu hình đã có version:
 * bắt buộc `If-Match` (thiếu 428, lệch 412), trả `ETag` mới, body 204.
 */
@Controller('channels')
export class ChannelMappingsController {
  constructor(
    @Inject(ChannelMappingsService) private readonly service: ChannelMappingsService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Put(':channelId/mappings')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @Header('Access-Control-Expose-Headers', 'ETag')
  @Permission('channels.mappings')
  @Idempotent(ChannelMappingAccess)
  @UseInterceptors(ChannelMappingsETagInterceptor)
  put(
    @Param('channelId') channelId: string,
    @Body() body: unknown,
    @Headers('if-match') tag: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.put(
      this.context.transaction(),
      actor(request),
      channelIdParam(channelId),
      mappingInput(body),
      expectedChannelVersion(typeof tag === 'string' ? tag : undefined),
    );
  }
}
