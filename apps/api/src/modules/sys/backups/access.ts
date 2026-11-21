import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { actor, forbidden } from '../settings/validation.js';
import { backupIdParam, backupInput, restoreInput } from './validation.js';

/**
 * Tiền kiểm **trước claim** idempotency (cùng cách `ReportExportAccess`): quyền hiện tại kiểm lại lần hai
 * (metadata `@Permission` sai cũng không lọt) và thân lệnh/tham số sai bị 400 mà không để lại khoá.
 */
@Injectable()
export class BackupAccess implements IdempotencyAccess {
  authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const current = actor(request);
    if (!current.hasPermission('systemBackups.request')) throw forbidden();
    backupInput(request.body);
    return Promise.resolve({ type: 'USER' as const, id: current.id });
  }
}

@Injectable()
export class RestoreAccess implements IdempotencyAccess {
  authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const current = actor(request);
    if (!current.hasPermission('systemBackups.request')) throw forbidden();
    backupIdParam(request.params);
    restoreInput(request.body);
    return Promise.resolve({ type: 'USER' as const, id: current.id });
  }
}
