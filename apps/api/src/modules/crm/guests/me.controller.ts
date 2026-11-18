/**
 * HB-250 — `GET /guests/me` và `/guests/me/loyalty` (api.md §2.10, UC-CRM-01/02): hồ sơ và điểm của **chính khách**
 * trong phiên khách. Chủ thể lấy từ phiên đã kiểm bằng cùng cơ chế với `GET /bookings` của khách (`bookingCaller`:
 * chữ ký + `auth_sessions` còn sống), nên tuyến là `@Public` và không có quyền RBAC nhân viên. Phiên nhân viên không
 * có "hồ sơ khách của tôi" → `403`. Đường tĩnh `guests/me` được Fastify ưu tiên hơn `guests/:guestId`.
 */
import { Controller, Get, Header, Inject, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { GuestLoyalty, GuestSummary } from '@pinehill/contracts';
import { Public } from '../../../common/guards/decorators.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { bookingCaller } from '../../book/bookings/principal.js';
import { forbidden } from '../../sys/settings/validation.js';
import { GuestsService } from './service.js';

@Controller('guests/me')
export class GuestsMeController {
  constructor(
    @Inject(GuestsService) private readonly service: GuestsService,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `guests.id` của phiên khách; phiên nhân viên → 403, thiếu/sai/hết phiên → 401 (từ `bookingCaller`). */
  private async guestId(request: FastifyRequest): Promise<string> {
    const caller = await bookingCaller(this.db, request, this.config, this.clock);
    if (caller.type !== 'GUEST') throw forbidden();
    return caller.id;
  }

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async profile(@Req() request: FastifyRequest): Promise<GuestSummary> {
    return this.service.own(await this.guestId(request));
  }

  @Public()
  @Get('loyalty')
  @Header('Cache-Control', 'no-store')
  async loyalty(@Req() request: FastifyRequest): Promise<GuestLoyalty> {
    return this.service.ownLoyalty(await this.guestId(request));
  }
}
