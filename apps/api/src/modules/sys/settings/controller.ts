import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Put,
  Query,
  Req,
  UseInterceptors,
  SetMetadata,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { SettingsService } from './service.js';
import { actor } from './validation.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { SettingsAccess } from './access.js';
import { SettingsETagInterceptor } from './etag-interceptor.js';
import { expectedVersion, input, key } from './command-input.js';
@Controller('system-settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly service: SettingsService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('systemSettings.read')
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.list(actor(request), query);
  }
  @Put(':key')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @Header('Access-Control-Expose-Headers', 'ETag')
  @Permission('systemSettings.update')
  @Idempotent(SettingsAccess)
  @SetMetadata('SYS_SETTING_COMMITTED', true)
  @UseInterceptors(SettingsETagInterceptor)
  async update(
    @Param('key') name: unknown,
    @Body() body: unknown,
    @Headers('if-match') tag: unknown,
    @Req() request: FastifyRequest,
  ) {
    const version = await this.service.update(
      this.context.transaction(),
      actor(request),
      key(name),
      input(body),
      expectedVersion(tag),
    );
    return `"${version}"`;
  }
}
