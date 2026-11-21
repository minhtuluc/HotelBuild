import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { ReportExportLocationInterceptor } from '../../rep/export/location-interceptor.js';
import { actor } from '../settings/validation.js';
import { BackupAccess, RestoreAccess } from './access.js';
import { BackupService } from './service.js';
import { backupIdParam, backupInput, restoreInput } from './validation.js';

/**
 * api.md §2.13 — `GET /system/backups` (trạng thái, SCR-18), `POST /system/backups` và
 * `POST /system/backups/{backupId}/restore` (202 + `Location` tới `/operations/{id}`, BR-SYS-03).
 * `Location` đặt bằng interceptor dùng chung của tác vụ bất đồng bộ (validator HB-029 cấm `@Res`).
 */
@Controller('system/backups')
export class BackupController {
  constructor(
    @Inject(BackupService) private readonly service: BackupService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('systemBackups.read')
  status() {
    return this.service.status();
  }

  @Post()
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @Permission('systemBackups.request')
  @Idempotent(BackupAccess)
  @UseInterceptors(ReportExportLocationInterceptor)
  backup(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.requestBackup(
      this.context.transaction(),
      actor(request),
      backupInput(body),
    );
  }

  @Post(':backupId/restore')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @Permission('systemBackups.request')
  @Idempotent(RestoreAccess)
  @UseInterceptors(ReportExportLocationInterceptor)
  restore(@Param() params: unknown, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.requestRestore(
      this.context.transaction(),
      actor(request),
      backupIdParam(params),
      restoreInput(body),
    );
  }
}
