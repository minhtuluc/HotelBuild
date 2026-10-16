import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { actor } from '../../sys/settings/validation.js';
import { ReportExportAccess } from './access.js';
import { ReportExportLocationInterceptor } from './location-interceptor.js';
import { ReportExportService } from './service.js';
import { exportInput } from './validation.js';

/**
 * api.md §2.12 — `POST /reports/export` trả 202 kèm `operationId` để theo dõi (NFR-COMP-04).
 * Lệnh ghi nên bắt buộc `Idempotency-Key` (BR-GEN-08): cùng khoá + cùng thân lệnh trả lại đúng kết quả
 * đã commit, khác thân lệnh ⇒ 409. `Location` (api.md §6.4) do interceptor đặt vì validator HB-029 cấm
 * tham số response trên lệnh idempotent.
 */
@Controller('reports')
export class ReportExportController {
  constructor(
    @Inject(ReportExportService) private readonly service: ReportExportService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Post('export')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @Permission('reports.export')
  @Idempotent(ReportExportAccess)
  @UseInterceptors(ReportExportLocationInterceptor)
  request(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.service.request(this.context.transaction(), actor(request), exportInput(body));
  }
}
