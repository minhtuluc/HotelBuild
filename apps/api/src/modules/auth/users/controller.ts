/**
 * HTTP người dùng nội bộ (HB-016; api.md §2.1; SCR-15): `GET /users`, `POST /users`,
 * `PUT /users/{userId}/access`. `PUT` đi qua idempotency (HB-029) với `If-Match`; `POST` **không** (QĐ-03 T9:
 * gửi lặp cùng khoá trả 409 `E_AUTH_USERNAME_TAKEN`, không phát lại 201 — phản hồi/thân lệnh chứa mật khẩu tạm).
 */
import { createHash } from 'node:crypto';
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
  Put,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { UsersAccess } from './access.js';
import { UserETagInterceptor } from './etag-interceptor.js';
import { UsersService } from './service.js';
import {
  accessInput,
  createInput,
  expectedVersion,
  listQuery,
  pathUserId,
  requestActor,
} from './validation.js';

@Controller('users')
export class UsersController {
  constructor(
    @Inject(UsersService) private readonly service: UsersService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Access-Control-Expose-Headers', 'ETag')
  @Permission('users.read')
  async list(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const page = await this.service.list(requestActor(request), listQuery(query));
    // ETag của trang = băm (id, version) theo thứ tự + phân trang, đổi khi bất kỳ dòng nào đổi version.
    const digest = createHash('sha256')
      .update(JSON.stringify([page.data.map((u) => [u.id, u.version]), page.meta]))
      .digest('hex');
    reply.header('ETag', `"${digest.slice(0, 32)}"`);
    return page;
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @Header('Access-Control-Expose-Headers', 'ETag')
  @Permission('users.create')
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const created = await this.service.create(requestActor(request), createInput(body));
    reply.status(201).header('ETag', `"${created.version}"`);
    return created;
  }

  @Put(':userId/access')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Access-Control-Expose-Headers', 'ETag')
  @Permission('users.access')
  @Idempotent(UsersAccess)
  @UseInterceptors(UserETagInterceptor)
  access(
    @Param('userId') userId: unknown,
    @Body() body: unknown,
    @Headers('if-match') tag: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.service.update(
      this.context.transaction(),
      requestActor(request),
      pathUserId(userId),
      accessInput(body),
      expectedVersion(tag),
    );
  }
}
