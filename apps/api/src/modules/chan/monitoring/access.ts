import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { actor, forbidden } from '../../sys/settings/validation.js';
import { ChannelSyncService } from '../sync/service.js';
import { channelIdParam, pathParam } from '../sync/validation.js';
import { deliveryIdParam } from './validation.js';

/**
 * Retry delivery — quyền MANAGER/OWNER kiểm **trước** khi tra delivery (không lộ sự tồn tại của hàng
 * cho vai trò khác), rồi mới kiểm định dạng tham số. Transaction của lệnh kiểm lại trạng thái hàng.
 */
@Injectable()
export class ChannelDeliveryRetryAccess implements IdempotencyAccess {
  constructor(@Inject(ChannelSyncService) private readonly channels: ChannelSyncService) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const current = actor(request);
    if (!current.hasPermission('channels.deliveryRetry')) throw forbidden();
    const channelId = channelIdParam(pathParam(request, 'channelId'));
    await this.channels.loadChannel(this.channels.db, channelId);
    deliveryIdParam(pathParam(request, 'deliveryId'));
    return { type: 'USER' as const, id: current.id };
  }
}
