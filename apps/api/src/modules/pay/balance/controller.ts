/**
 * `GET /bookings/{bookingId}/balance` (HB-096; api.md §2.6): số dư và khoản hoàn cho **khách sở hữu**
 * hoặc **nhân viên tài chính** (§6.3, không cấp HOUSEKEEPING).
 *
 * Vì sao `@Public()` + phân giải chủ thể tại chỗ thay vì `@Permission`: phiên khách (HB-017) dùng vai
 * trò `GUEST` không nằm trong `userRoleSchema`, nên `PermissionRegistry` từ chối khai nó ngay khi khởi
 * động; `AuthGuard` (HB-013) cũng chỉ xác thực phiên nhân viên. Cùng lý do và cùng cách làm như ba
 * tuyến BOOK của HB-077 — dùng lại `bookingCaller` (đã kiểm chữ ký/hạn token và **đọc lại** vai trò/
 * phạm vi cơ sở từ CSDL cho nhân viên), rồi service kiểm quyền `bookings.balance` + phạm vi.
 */
import { Controller, Get, Header, HttpCode, Inject, Param, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { BookingBalance } from '@pinehill/contracts';
import { Public } from '../../../common/guards/decorators.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { bookingCaller } from '../../book/bookings/principal.js';
import { bookingId } from '../../book/bookings/validation.js';
import { BookingBalanceService } from './service.js';

@Public()
@Controller('bookings')
export class BalanceController {
  constructor(
    @Inject(BookingBalanceService) private readonly service: BookingBalanceService,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get(':bookingId/balance')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async balance(
    @Param('bookingId') id: unknown,
    @Req() request: FastifyRequest,
  ): Promise<BookingBalance> {
    const caller = await bookingCaller(this.db, request, this.config, this.clock);
    return this.service.read(caller, bookingId(id));
  }
}
