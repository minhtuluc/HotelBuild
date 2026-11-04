import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { forbidden } from './validation.js';

/**
 * Danh tính cho khoá chống trùng là **nhân viên đã đăng nhập**, không phải booking trong URL: hai
 * người soát cùng booking phải ghi hai quyết định khác nhau. Kiểm tra sâu (tồn tại booking, kênh,
 * scope cơ sở, version) nằm **trong** transaction của lệnh để lỗi 404/403/412 không tiêu một khoá
 * chống trùng và cũng không tự tạo một khoá trước khi biết lệnh có hợp lệ hay không.
 */
@Injectable()
export class OtaReviewAccess implements IdempotencyAccess {
  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isAuthorizedActor(request.actor)) throw forbidden();
    return { type: 'USER', id: request.actor.id };
  }
}
