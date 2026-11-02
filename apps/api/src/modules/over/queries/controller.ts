/**
 * Tuyến đọc ca quá tải (HB-126; api.md §3.9 + HB-120 AC12).
 *
 * `GET /overbooking-cases` và `/{id}` là MANAGER/OWNER; `GET /overbooking-alerts` là projection tối
 * giản cho FRONT_DESK. Route detail dùng tham số `:id` (không phải `:caseId`) để oracle RBAC chung
 * thay được id giả và trả 404 trước khi chạm dữ liệu.
 */
import { Controller, Get, Header, Inject, Param, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { requestActor, uuid } from '../../rate/calendar/support.js';
import { OverbookingQueries } from './service.js';
import { alertQuery, caseQuery, detailQuery } from './validation.js';

@Controller('overbooking-cases')
export class OverbookingCasesController {
  constructor(@Inject(OverbookingQueries) private readonly service: OverbookingQueries) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('overbookings.cases.read')
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.list(requestActor(request), caseQuery(query));
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @Permission('overbookings.cases.read')
  detail(@Param('id') id: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.detail(
      requestActor(request),
      uuid(id),
      detailQuery(query).includeCandidates === true,
    );
  }
}

@Controller('overbooking-alerts')
export class OverbookingAlertsController {
  constructor(@Inject(OverbookingQueries) private readonly service: OverbookingQueries) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('overbookings.alerts.read')
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.alerts(requestActor(request), alertQuery(query));
  }
}
