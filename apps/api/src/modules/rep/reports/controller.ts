import { Controller, Get, Header, Inject, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { actor } from '../../sys/settings/validation.js';
import { ReportsService } from './service.js';
import {
  adrRevparInput,
  cancellationsInput,
  forceMajeureInput,
  occupancyInput,
  overbookingInput,
  revenueByChannelInput,
} from './validation.js';

/** api.md §2.12 — sáu báo cáo REP. Mọi tuyến chỉ đọc và không lưu cache. */
@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly service: ReportsService) {}

  @Get('occupancy')
  @Header('Cache-Control', 'no-store')
  @Permission('reports.occupancy')
  occupancy(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.occupancy(actor(request), occupancyInput(query));
  }

  @Get('adr-revpar')
  @Header('Cache-Control', 'no-store')
  @Permission('reports.adrRevpar')
  adrRevpar(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.adrRevpar(actor(request), adrRevparInput(query));
  }

  @Get('revenue-by-channel')
  @Header('Cache-Control', 'no-store')
  @Permission('reports.revenueByChannel')
  revenueByChannel(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.revenueByChannel(actor(request), revenueByChannelInput(query));
  }

  @Get('cancellations')
  @Header('Cache-Control', 'no-store')
  @Permission('reports.cancellations')
  cancellations(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.cancellations(actor(request), cancellationsInput(query));
  }

  @Get('force-majeure')
  @Header('Cache-Control', 'no-store')
  @Permission('reports.forceMajeure')
  forceMajeure(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.forceMajeure(actor(request), forceMajeureInput(query));
  }

  @Get('overbooking')
  @Header('Cache-Control', 'no-store')
  @Permission('reports.overbooking')
  overbooking(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.overbooking(actor(request), overbookingInput(query));
  }
}
