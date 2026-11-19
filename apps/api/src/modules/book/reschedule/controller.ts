/**
 * `POST /bookings/{bookingId}/reschedule` (200 + `BookingSummary`) và `DELETE /bookings/{bookingId}`
 * (204) — HB-098, api.md §2.5, §3.3.
 *
 * Cả hai là lệnh ghi có `Idempotency-Key` (hợp đồng F5 `bearerWrite`) nên đi qua interceptor HB-029 và
 * handler lấy transaction từ `IdempotencyContext`; `@Idempotent` gắn lớp tiền kiểm tương ứng. `If-Match`
 * của lệnh đổi ngày là `version` mà `GET /bookings/{id}` / chính phản hồi đổi ngày trả về
 * (`BookingSummary.version`, api.md §3.2) — hợp đồng §6.4 buộc lệnh đổi ngày kèm version.
 */
import {
  Body,
  Controller,
  Delete,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { BookingSummary } from '@pinehill/contracts';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { Public } from '../../../common/guards/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { cancelCaller } from '../cancel/caller.js';
import { HardDeleteAccess, RescheduleAccess } from './access.js';
import { RescheduleService } from './service.js';
import { bookingId, deleteReason, requestActor, rescheduleInput } from './validation.js';

@Controller('bookings')
export class RescheduleController {
  constructor(
    @Inject(RescheduleService) private readonly service: RescheduleService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
    @Inject(PRISMA) readonly db: PrismaClient,
    @Inject(CONFIG) readonly config: ApiConfig,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(PermissionRegistry) readonly permissions: PermissionRegistry,
  ) {}

  /** AC1/AC2: đổi ngày, giữ nguyên trạng thái, append ảnh giá RESCHEDULE, nhả chỗ cũ (BR-BOOK-12). */
  // HB-258: `@Public` để khách tự đổi ngày booking của mình (api.md §2.5); chủ thể tự xác thực ở `cancelCaller`.
  @Public()
  @Post(':bookingId/reschedule')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Idempotent(RescheduleAccess)
  async reschedule(
    @Param('bookingId') id: unknown,
    @Body() body: unknown,
    @Headers('if-match') tag: unknown,
    @Req() request: FastifyRequest,
  ): Promise<BookingSummary> {
    return this.service.reschedule(
      this.context.transaction(),
      await cancelCaller(this, request, 'bookings.reschedule'),
      bookingId(id),
      rescheduleInput(body),
      tag,
    );
  }

  /** AC3: xoá cứng `DRAFT`/`HELD` chưa phát sinh thanh toán; audit `beforeJson` do trigger ghi (204). */
  @Delete(':bookingId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @Permission('bookings.delete')
  @Idempotent(HardDeleteAccess)
  async remove(
    @Param('bookingId') id: unknown,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.service.hardDelete(
      this.context.transaction(),
      requestActor(request),
      bookingId(id),
      deleteReason(query),
    );
  }
}
