import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { actor, forbidden } from '../../sys/settings/validation.js';
import { exportInput } from './validation.js';

/**
 * HB-029/HB-163: `POST /reports/export` là lệnh ghi **không có tài nguyên đích** nên `authorize` chỉ
 * kiểm quyền hiện tại của người gọi rồi kiểm thân lệnh. Vai trò đã chặn ở `@Permission`; kiểm lại lần
 * hai tại đây (cùng cách `AllotmentAccess`) để metadata sai cũng không lọt. `exportInput` chạy **trước
 * claim** nên lệnh sai định dạng bị 400 và không để lại bản ghi khoá idempotency.
 */
@Injectable()
export class ReportExportAccess implements IdempotencyAccess {
  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const current = actor(request);
    if (!current.hasPermission('reports.export')) throw forbidden();
    exportInput(request.body);
    return { type: 'USER' as const, id: current.id };
  }
}
