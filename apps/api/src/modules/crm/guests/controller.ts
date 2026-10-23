import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { actor } from '../../sys/settings/validation.js';
import { GuestsService } from './service.js';
import {
  guestAnonymizeInput,
  guestBlacklistInput,
  guestBlacklistReleaseInput,
  guestCreateInput,
  guestPathId,
  guestSearchInput,
} from './validation.js';

/** api.md §2.10 — hồ sơ khách tại quầy + thao tác quản trị. Không có tuyến xoá cứng (§2.14). */
@Controller('guests')
export class GuestsController {
  constructor(@Inject(GuestsService) private readonly service: GuestsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('guests.read')
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.search(actor(request), guestSearchInput(query));
  }

  /** HB-208: đọc hồ sơ theo id (SCR-57/62 ghép tên, cờ danh sách đen). Đăng ký sau `@Get()`, trước các tuyến con. */
  @Get(':guestId')
  @Header('Cache-Control', 'no-store')
  @Permission('guests.read')
  get(@Param('guestId') guestId: string, @Req() request: FastifyRequest) {
    return this.service.get(actor(request), guestPathId(guestId));
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

  /** Ẩn danh hoá là chuyển trạng thái hồ sơ đã có (không tạo tài nguyên) → `200` kèm hồ sơ đã ẩn danh. */
  @Post(':guestId/anonymize')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permission('guests.manage')
  anonymize(
    @Param('guestId') guestId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.anonymize(actor(request), guestPathId(guestId), guestAnonymizeInput(body));
  }

  @Get(':guestId/loyalty')
  @Header('Cache-Control', 'no-store')
  @Permission('guests.read')
  loyalty(@Param('guestId') guestId: string, @Req() request: FastifyRequest) {
    return this.service.loyalty(actor(request), guestPathId(guestId));
  }

  @Post(':guestId/blacklist')
  @Header('Cache-Control', 'no-store')
  @Permission('guests.manage')
  blacklist(
    @Param('guestId') guestId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.blacklist(actor(request), guestPathId(guestId), guestBlacklistInput(body));
  }

  @Delete(':guestId/blacklist')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @Permission('guests.manage')
  async releaseBlacklist(
    @Param('guestId') guestId: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ) {
    await this.service.releaseBlacklist(
      actor(request),
      guestPathId(guestId),
      guestBlacklistReleaseInput(query),
    );
  }
}
