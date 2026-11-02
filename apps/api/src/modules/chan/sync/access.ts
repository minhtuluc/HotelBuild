import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { actor, forbidden } from '../../sys/settings/validation.js';
import { ChannelSyncService } from './service.js';
import { channelIdParam, pathParam, syncInput } from './validation.js';

/**
 * Kiểm quyền **trước khi claim** khoá idempotency (api.md §1.6, BR-RBAC-02):
 * quyền route (MANAGER/OWNER) → kênh tồn tại → thân lệnh hợp lệ → scope cơ sở của từng loại phòng.
 * Chạy lại lần nữa bên trong transaction của service vì preflight không phải ranh giới nghiệp vụ.
 */
@Injectable()
export class ChannelSyncAccess implements IdempotencyAccess {
  constructor(@Inject(ChannelSyncService) private readonly service: ChannelSyncService) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const current = actor(request);
    if (!current.hasPermission('channels.sync')) throw forbidden();
    const channelId = channelIdParam(pathParam(request, 'channelId'));
    await this.service.loadChannel(this.service.db, channelId);
    const input = syncInput(request.body);
    await this.service.authorizedRoomTypes(this.service.db, current, input.roomTypeIds);
    return { type: 'USER' as const, id: current.id };
  }
}
