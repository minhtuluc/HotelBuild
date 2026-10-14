import { Body, Controller, Get, Header, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { actor } from '../../sys/settings/validation.js';
import { GuestsService } from './service.js';
import { guestCreateInput, guestSearchInput } from './validation.js';

/** api.md §2.10 — hồ sơ khách tại quầy. Không có tuyến xoá cứng (§2.14). */
@Controller('guests')
export class GuestsController {
  constructor(@Inject(GuestsService) private readonly service: GuestsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('guests.read')
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.search(actor(request), guestSearchInput(query));
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @Permission('guests.create')
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.service.create(actor(request), guestCreateInput(body));
    // 201 khi tạo mới; 200 khi SĐT đã có hồ sơ (trả hồ sơ cũ, không tạo bản thứ hai).
    reply.status(result.created ? 201 : 200);
    return result.summary;
  }
}
