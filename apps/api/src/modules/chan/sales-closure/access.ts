import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { actor, forbidden } from '../../sys/settings/validation.js';
import { ChannelSyncService } from '../sync/service.js';
import { channelIdParam, pathParam } from '../sync/validation.js';
import { ChannelSalesClosureService } from './service.js';
import { closureInput } from './validation.js';

/** Kiểm quyền + scope + thân lệnh trước khi claim khoá idempotency (BR-RBAC-02, api.md §1.6). */
@Injectable()
export class ChannelSalesClosureAccess implements IdempotencyAccess {
  constructor(
    @Inject(ChannelSyncService) private readonly channels: ChannelSyncService,
    @Inject(ChannelSalesClosureService) private readonly service: ChannelSalesClosureService,
  ) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const current = actor(request);
    if (!current.hasPermission('channels.salesClosure')) throw forbidden();
    const channelId = channelIdParam(pathParam(request, 'channelId'));
    await this.channels.loadChannel(this.service.db, channelId);
    const input = closureInput(request.body);
    const type = await this.channels.loadRoomType(this.service.db, input.roomTypeId);
    requireProperty(current, type.property_id);
    return { type: 'USER' as const, id: current.id };
  }
}
