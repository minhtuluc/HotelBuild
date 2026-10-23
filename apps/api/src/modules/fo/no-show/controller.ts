/**
 * `POST /api/v1/front-office/no-show` (HB-147; UC-FO-04; api.md §2.9, §6.3).
 *
 * Ghi nhận khách không đến: chỉ FRONT_DESK/MANAGER/OWNER (`frontOffice.noShow`), chỉ booking
 * `CONFIRMED` và chỉ từ 23:59 ngày nhận phòng (BR-CANCEL-10). Lệnh ghi nên bắt buộc `Idempotency-Key`;
 * mọi thay đổi trạng thái/tiền/audit/outbox nằm trong **một** transaction của khoá đó.
 */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { NoShowPreview, NoShowResponse } from '@pinehill/contracts';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { Permission } from '../../../common/rbac/permissions.js';
import { NoShowAccess } from './access.js';
import { NoShowService } from './service.js';
import { noShowActor, noShowInput, noShowPreviewInput } from './validation.js';

@Controller('front-office')
export class NoShowController {
  constructor(
    @Inject(NoShowService) private readonly service: NoShowService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Post('no-show')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permission('frontOffice.noShow')
  @Idempotent(NoShowAccess)
  mark(@Body() body: unknown, @Req() request: FastifyRequest): Promise<NoShowResponse> {
    return this.service.mark(this.context.transaction(), noShowActor(request), noShowInput(body));
  }

  /**
   * `POST /front-office/no-show/preview` (HB-209, TD-28): xem trước tiền no-show. Cùng quyền với lệnh ghi,
   * **không** `Idempotency-Key` (không ghi) và không PIN; số không ràng buộc — lệnh ghi tính lại sau khoá.
   */
  @Post('no-show/preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permission('frontOffice.noShow')
  preview(@Body() body: unknown, @Req() request: FastifyRequest): Promise<NoShowPreview> {
    return this.service.preview(noShowActor(request), noShowPreviewInput(body));
  }
}
