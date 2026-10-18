/**
 * `POST /bookings`, `GET /bookings`, `GET /bookings/{bookingId}` và
 * `POST /bookings/{bookingId}/confirm` (HB-077; api.md §2.5, §3.2).
 *
 * `@Public()` ở ba tuyến đầu là **có chủ ý**, không phải bỏ quên phân quyền: chúng là tuyến của **phiên
 * khách** (api.md §2.5 vai trò GUEST) mà `GUEST` không phải vai trò trong `userRoleSchema`, còn
 * `AuthGuard` (HB-013) chỉ xác thực phiên nhân viên — nhánh phiên khách thuộc HB-017. Vì vậy module tự
 * phân giải chủ thể (`principal.ts`) theo đúng cách `POST /quotes` (HB-074) và `POST /holds` (HB-076):
 * vẫn đòi Bearer hợp lệ (401), đọc lại `users.role`/`is_active`/phạm vi cơ sở từ CSDL, kiểm
 * `bookings.read`/`bookings.create` cho nhân viên. Khi HB-017 mở phiên khách, ba tuyến này chuyển sang
 * guard chung và bỏ nhánh phân giải tại chỗ.
 *
 * `confirm` thì **giữ** `@Permission('bookings.confirm')` (vai trò tối thiểu FRONT_DESK, api.md §2.5) —
 * nó là tuyến nhân viên nên đi qua `RbacGuard` và có mục riêng trong oracle RBAC.
 *
 * `Idempotency-Key` bắt buộc theo hợp đồng F4 (`bearerWrite`), nên hai lệnh ghi đi qua interceptor HB-029
 * và handler lấy transaction từ `IdempotencyContext`. `Location` của `201` và trạng thái `200` (BR-BOOK-16
 * trả booking đã có) do handler đặt trên reply; interceptor chụp lại để phát lại y nguyên.
 */
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { BookingSummary, ListPage } from '@pinehill/contracts';
import { Public } from '../../../common/guards/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { BookingAccess } from './access.js';
import { BookingCreatedInterceptor } from './created-interceptor.js';
import { bookingCaller } from './principal.js';
import { BookingsService } from './service.js';
import type { BookingCreationResult } from './service.js';
import { bookingId, confirmInput, listQuery } from './validation.js';

@Controller('bookings')
export class BookingsController {
  constructor(
    @Inject(BookingsService) private readonly service: BookingsService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private caller(request: FastifyRequest) {
    return bookingCaller(this.db, request, this.config, this.clock);
  }

  /** AC1–AC3: quote → booking trong một transaction, snapshot ORIGINAL, nghi trùng BR-BOOK-16. */
  @Public()
  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @Idempotent(BookingAccess)
  @UseInterceptors(BookingCreatedInterceptor)
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<BookingCreationResult> {
    // Trả cả `created` cho interceptor (nó đặt `201`/`200` + `Location` rồi mở gói thành `BookingSummary`).
    return this.service.create(this.context.transaction(), await this.caller(request), body);
  }

  /** AC4: khách chỉ thấy booking của mình, nhân viên theo phạm vi cơ sở, HOUSEKEEPING không có tuyến. */
  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ListPage<BookingSummary>> {
    return this.service.list(await this.caller(request), listQuery(query));
  }

  @Public()
  @Get(':bookingId')
  @Header('Cache-Control', 'no-store')
  async get(
    @Param('bookingId') id: unknown,
    @Req() request: FastifyRequest,
  ): Promise<BookingSummary> {
    return this.service.get(await this.caller(request), bookingId(id));
  }

  /** AC3: chỉ `HELD`/`PENDING_PAYMENT` còn hạn theo giờ CSDL mới xác nhận được (BR-BOOK-09,18). */
  @Post(':bookingId/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permission('bookings.confirm')
  @Idempotent(BookingAccess)
  async confirm(
    @Param('bookingId') id: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<BookingSummary> {
    return this.service.confirm(
      this.context.transaction(),
      await this.caller(request),
      bookingId(id),
      confirmInput(body).paymentId,
    );
  }
}
