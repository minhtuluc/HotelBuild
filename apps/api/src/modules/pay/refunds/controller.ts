/** Controller hoàn tiền (HB-099, api.md §3.6/§3.7): 4 lệnh ghi đều đòi `Idempotency-Key`. */
import {
  Body,
  Controller,
  Get,
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
import type { ListPage, RefundRequest } from '@pinehill/contracts';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { RefundAccess } from './access.js';
import { RefundService } from './service.js';
import { commandKey, createInput, listQuery, refundId, requestActor } from './validation.js';

@Controller('refund-requests')
export class RefundController {
  constructor(
    @Inject(RefundService) private readonly service: RefundService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  /**
   * HB-213 / api.md §2.6 — danh sách hồ sơ hoàn cho SCR-38. Tuyến đọc: `Cache-Control: no-store`,
   * không trả `pinToken`/số tài khoản thô; phạm vi cơ sở lọc trong truy vấn, đúng `refundListQuerySchema`.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  @Permission('refunds.read')
  list(@Query() query: unknown, @Req() request: FastifyRequest): Promise<ListPage<RefundRequest>> {
    return this.service.list(requestActor(request), listQuery(query));
  }

  /** Lập hồ sơ hoàn PENDING + giữ hạn mức NET; `Idempotency-Key` cũng làm `event_key` ổn định. */
  @Post()
  @HttpCode(201)
  @Permission('refunds.create')
  @Idempotent(RefundAccess)
  create(
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.create(
      this.context.transaction(),
      requestActor(request),
      createInput(body),
      commandKey(key),
    );
  }

  /** Duyệt: hai cấp maker–checker, đòi `pinToken`, ngưỡng lớn cần MANAGER+ (BR-CANCEL-15). */
  @Post(':refundRequestId/approve')
  @HttpCode(200)
  @Permission('refunds.approve')
  @Idempotent(RefundAccess)
  approve(
    @Param('refundRequestId') id: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.approve(
      this.context.transaction(),
      requestActor(request),
      refundId(id),
      body,
    );
  }

  /** Từ chối PENDING: ghi lý do và trả hạn mức (BR-CANCEL-17). */
  @Post(':refundRequestId/reject')
  @HttpCode(200)
  @Permission('refunds.reject')
  @Idempotent(RefundAccess)
  reject(
    @Param('refundRequestId') id: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.reject(
      this.context.transaction(),
      requestActor(request),
      refundId(id),
      body,
    );
  }

  /** Rút PENDING: người tạo hoặc MANAGER/OWNER, bắt buộc lý do (BR-CANCEL-18). */
  @Post(':refundRequestId/cancel')
  @HttpCode(200)
  @Permission('refunds.cancel')
  @Idempotent(RefundAccess)
  cancel(
    @Param('refundRequestId') id: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.cancel(
      this.context.transaction(),
      requestActor(request),
      refundId(id),
      body,
    );
  }
}
