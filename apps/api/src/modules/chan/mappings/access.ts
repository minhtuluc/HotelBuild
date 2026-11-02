import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { actor, forbidden } from '../../sys/settings/validation.js';
import { ChannelMappingsService } from './service.js';
import { bodyString, expectedChannelVersion, mappingInput, versionConflict } from './validation.js';
import { channelIdParam, pathParam } from '../sync/validation.js';

/**
 * Thứ tự kiểm của `PUT /channels/{id}/mappings` (giữ đúng hợp đồng đã công bố):
 * quyền → kênh → `If-Match` (428/412) → mã OTA trùng (409) → scope cơ sở (403) → thân lệnh strict (400).
 */
@Injectable()
export class ChannelMappingAccess implements IdempotencyAccess {
  constructor(@Inject(ChannelMappingsService) private readonly service: ChannelMappingsService) {}

  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const current = actor(request);
    if (!current.hasPermission('channels.mappings')) throw forbidden();
    const channelId = channelIdParam(pathParam(request, 'channelId'));
    const channel = await this.service.loadChannel(this.service.db, channelId);
    const tag = request.headers['if-match'];
    const expected = expectedChannelVersion(typeof tag === 'string' ? tag : undefined);
    if (expected !== channel.version) throw versionConflict();

    const roomTypeId = bodyString(request.body, 'roomTypeId').toLowerCase();
    const providerRoomTypeCode = bodyString(request.body, 'providerRoomTypeCode');
    await this.service.assertProviderCodeFree(
      this.service.db,
      channelId,
      roomTypeId,
      providerRoomTypeCode,
    );
    const type = await this.service.loadRoomType(this.service.db, roomTypeId);
    requireProperty(current, type.property_id);
    mappingInput(request.body);
    return { type: 'USER' as const, id: current.id };
  }
}
