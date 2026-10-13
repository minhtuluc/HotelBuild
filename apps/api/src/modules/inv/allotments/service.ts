import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { channelCodeSchema } from '@pinehill/contracts';
import { calculateAvailability } from '@pinehill/domain/inventory';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { AppError } from '../../../common/app-error.js';
import { RetryTransaction } from '../../../common/idempotency/transaction-retry.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { loadInventoryFacts } from '../facts/loader.js';
import { inventoryError } from '../../prop/room-blocks/locks.js';
import { assertLockedActor } from '../../prop/room-blocks/locked-actor.js';
import { lockAllotmentScope, readAllotmentConfiguration, allotmentETag } from './scope.js';
import { forbidden, missing, nextDate, writeInput } from './validation.js';
import type { ReadInput, WriteInput } from './validation.js';

export class AllotmentsService {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly audit: AuditWriter,
  ) {}
  async authorizedScope(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    input: { roomTypeId: string; channelId: string },
  ) {
    if (!['MANAGER', 'OWNER'].includes(actor.role)) throw forbidden();
    const type = await tx.room_types.findUnique({
      where: { id: input.roomTypeId },
      include: { properties: true },
    });
    if (!type) throw missing();
    requireProperty(actor, type.property_id);
    const channel = await tx.channels.findUnique({ where: { id: input.channelId } });
    if (!channel) throw missing();
    return { type, channel };
  }
  async list(actor: AuthorizedActor, input: ReadInput) {
    return this.db.$transaction(
      async (tx) => {
        const { type, channel } = await this.authorizedScope(tx, actor, input);
        const config = await readAllotmentConfiguration(tx, input, input.from, input.to);
        const facts = await loadInventoryFacts(tx, {
          propertyId: type.property_id,
          roomTypeId: type.id,
          checkIn: input.from,
          checkOut: nextDate(input.to),
          channelCode: channelCodeSchema.parse(channel.code),
        });
        const result = calculateAvailability(facts);
        const availability = result.ok
          ? result.value
          : result.error.code === 'E_INV_NO_AVAILABILITY'
            ? result.error.availability
            : null;
        if (!availability) throw new Error('Invalid inventory facts');
        const used = new Map(availability.nightly.map((night) => [night.date, night.used]));
        const data = config.items.map((item) => ({
          date: item.date,
          allotment: item.allotment,
          used: used.get(item.date) ?? 0,
        }));
        return {
          etag: allotmentETag(config.version),
          body: { data, meta: { limit: 31, total: data.length, hasMore: false, nextCursor: null } },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async put(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    value: WriteInput,
    expected: bigint,
  ) {
    // Revalidate inside the command transaction; preflight alone is not the business boundary.
    const input = writeInput({ ...value, ...(value.reason === null ? { reason: undefined } : {}) });
    try {
      const scope = await this.authorizedScope(tx, actor, input);
      await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
      // Keep capacity stable during validation and all child writes. GET acquires none of these locks.
      await tx.$queryRaw`SELECT id FROM properties WHERE id=${scope.type.property_id}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM room_types WHERE id=${input.roomTypeId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM rooms WHERE room_type_id=${input.roomTypeId}::uuid ORDER BY id FOR SHARE`;
      const lockedScope = await this.authorizedScope(tx, actor, input);
      if (lockedScope.type.property_id !== scope.type.property_id)
        throw new RetryTransaction(
          new AppError(409, 'E_INV_LOCK_TIMEOUT', 'Phạm vi tồn đã thay đổi; vui lòng thử lại.'),
        );
      await lockAllotmentScope(tx, input, expected);
      await assertLockedActor(tx, actor, lockedScope.type.property_id);
      const capacity = await this.capacity(tx, input.roomTypeId);
      const details = input.items
        .filter((item) => item.allotment > capacity)
        .map((item) => ({
          field: `items[${item.date}].allotment`,
          issue: 'EXCEEDS_ACTIVE_SUPPLY',
        }));
      if (details.length > 0)
        throw new AppError(
          409,
          'E_INV_ALLOTMENT_EXCEEDS_ROOMS',
          'Hạn mức vượt số đơn vị bán đang hoạt động.',
          undefined,
          details,
        );
      const dates = input.items.map((item) => item.date).sort();
      const from = dates[0]!,
        to = dates.at(-1)!;
      const before = await readAllotmentConfiguration(tx, input, from, to);
      for (const item of input.items) {
        const date = new Date(`${item.date}T00:00:00Z`);
        await tx.channel_allotments.upsert({
          where: {
            channel_id_room_type_id_date: {
              channel_id: input.channelId,
              room_type_id: input.roomTypeId,
              date,
            },
          },
          create: {
            channel_id: input.channelId,
            room_type_id: input.roomTypeId,
            date,
            allotment: item.allotment,
          },
          update: { allotment: item.allotment, version: { increment: 1 } },
        });
      }
      const after = await readAllotmentConfiguration(tx, input, from, to);
      await this.audit.record(tx, {
        actor,
        action: 'ALLOTMENT_UPDATED',
        entityType: 'ChannelAllotment',
        entityId: input.roomTypeId,
        beforeJson: {
          channelId: input.channelId,
          roomTypeId: input.roomTypeId,
          version: before.version.toString(),
          items: before.items,
        },
        afterJson: {
          channelId: input.channelId,
          roomTypeId: input.roomTypeId,
          version: after.version.toString(),
          items: after.items,
        },
        reason: input.reason,
      });
      // BR-CHAN-06: consumers reload scoped facts; this event never publishes raw quota as sellable stock.
      await tx.outbox_events.create({
        data: {
          event_type: 'InventoryChanged',
          aggregate_type: 'ChannelAllotment',
          aggregate_id: input.roomTypeId,
          payload_json: {
            schemaVersion: 1,
            propertyId: lockedScope.type.property_id,
            channelId: input.channelId,
            roomTypeId: input.roomTypeId,
            version: after.version.toString(),
            dates,
          },
        },
      });
      return allotmentETag(after.version);
    } catch (error) {
      inventoryError(error);
    }
  }
  private async capacity(tx: Prisma.TransactionClient, typeId: string): Promise<number> {
    const type = await tx.room_types.findUnique({
      where: { id: typeId },
      include: { properties: true },
    });
    if (!type) throw missing();
    if (type.status !== 'ACTIVE' || type.properties.status !== 'ACTIVE') return 0;
    const rooms = await tx.rooms.findMany({
      where: { room_type_id: typeId, status: 'ACTIVE' },
      select: { bed_count: true },
    });
    return rooms.reduce((sum, room) => sum + (type.allow_shared ? room.bed_count : 1), 0);
  }
}
