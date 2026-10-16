import { Controller, Get, Header, Inject, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../../common/guards/decorators.js';
import { AvailabilityRateLimit } from './rate-limit.js';
import { AvailabilityService } from './service.js';
import { availabilityInput } from './validation.js';

/**
 * Công khai (api.md §2.3 vai trò "—"): khách tìm phòng trước khi đăng nhập journey F4.
 * Hạn mức theo IP chạy **trước** khi đọc dữ liệu để một client lỗi không quét được cơ sở dữ liệu.
 */
@Controller('inventory/availability')
export class AvailabilityController {
  constructor(
    @Inject(AvailabilityService) private readonly service: AvailabilityService,
    @Inject(AvailabilityRateLimit) private readonly rateLimit: AvailabilityRateLimit,
  ) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async search(@Query() query: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.assertAllowed(request.ip ?? 'unknown');
    return this.service.search(availabilityInput(query));
  }
}
