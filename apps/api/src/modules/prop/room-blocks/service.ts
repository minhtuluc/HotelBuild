import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import type { ListPage, RoomBlockCreateRequest, RoomBlock } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { loadInventoryFacts } from '../../inv/facts/loader.js';
import { createInput, deleteReason, forbidden, missing, uuid } from './validation.js';
import type { BlockListQuery } from './validation.js';
import { lockInventory, inventoryError } from './locks.js';
import { blockHistory, blockDto, blockSnapshot } from './history.js';
import { recordCases } from './cases.js';
import { listWhere, validateListRange } from './listing.js';
export class RoomBlocksService {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly ids: IdGenerator,
    readonly audit: AuditWriter,
  ) {}
  async create(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    value: RoomBlockCreateRequest,
  ): Promise<RoomBlock> {
    if (!['FRONT_DESK', 'MANAGER', 'OWNER'].includes(actor.role)) throw forbidden();
    const input = createInput(value),
      start = new Date(`${input.startDate}T00:00:00Z`),
      end = new Date(`${input.endDate}T00:00:00Z`);
    try {
      const { room, affectedBookings } = await lockInventory(tx, actor, input.roomId, start, end);
      if (affectedBookings.length > 0 && !['MANAGER', 'OWNER'].includes(actor.role))
        throw forbidden();
      const block = await tx.room_blocks.create({
        data: {
          id: this.ids.generate(),
          room_id: room.id,
          start_date: start,
          end_date: end,
          reason: input.reason,
          created_by: actor.id,
        },
      });
      const dto = blockDto(block, input.note ?? null);
      const facts = await loadInventoryFacts(tx, {
        propertyId: room.property_id,
        roomTypeId: room.room_type_id,
        checkIn: input.startDate,
        checkOut: input.endDate,
        channelCode: 'WEB',
      });
      await recordCases(tx, actor, facts, this.audit);
      await this.audit.record(tx, {
        actor,
        action: 'ROOM_BLOCK_CREATED',
        entityType: 'RoomBlock',
        entityId: block.id,
        beforeJson: null,
        afterJson: {
          ...dto,
          propertyId: room.property_id,
          roomTypeId: room.room_type_id,
          affectedBookingIds: affectedBookings,
        },
        reason: input.reason,
      });
      await this.inventoryEvent(tx, room.property_id, room.room_type_id, dto, 'CREATED');
      return dto;
    } catch (error) {
      return inventoryError(error);
    }
  }
  async remove(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    id: string,
    value: string,
  ): Promise<void> {
    if (!['MANAGER', 'OWNER'].includes(actor.role)) throw forbidden();
    const reason = deleteReason(value);
    id = uuid(id);
    try {
      const before = await tx.room_blocks.findUnique({ where: { id } });
      if (!before) throw missing();
      const { room } = await lockInventory(
        tx,
        actor,
        before.room_id,
        before.start_date,
        before.end_date,
      );
      const current = await tx.room_blocks.findUnique({ where: { id } });
      if (!current) throw missing();
      const history = await blockHistory(tx, id);
      await this.audit.record(tx, {
        actor,
        action: 'ROOM_BLOCK_REMOVED',
        entityType: 'RoomBlock',
        entityId: id,
        beforeJson: blockSnapshot(current, history.note),
        afterJson: null,
        reason,
      });
      await tx.room_blocks.delete({ where: { id } });
      await this.inventoryEvent(
        tx,
        room.property_id,
        room.room_type_id,
        blockDto(current, history.note),
        'REMOVED',
      );
    } catch (error) {
      inventoryError(error);
    }
  }
  async list(actor: AuthorizedActor, query: BlockListQuery): Promise<ListPage<RoomBlock>> {
    if (!['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER', 'OWNER'].includes(actor.role)) throw forbidden();
    if (query.propertyId) requireProperty(actor, query.propertyId.toLowerCase());
    validateListRange(query);
    if (query.roomId) {
      const room = await this.db.rooms.findUnique({ where: { id: query.roomId } });
      if (!room) throw missing();
      requireProperty(actor, room.property_id);
    }
    const where = listWhere(actor, query);
    const [total, blocks] = await Promise.all([
      this.db.room_blocks.count({ where }),
      this.db.room_blocks.findMany({
        where: { ...where, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: query.limit + 1,
      }),
    ]);
    const hasMore = blocks.length > query.limit,
      selected = blocks.slice(0, query.limit);
    return {
      data: await Promise.all(
        selected.map(async (block) =>
          blockDto(block, (await blockHistory(this.db, block.id)).note),
        ),
      ),
      meta: {
        total,
        limit: query.limit,
        hasMore,
        nextCursor: hasMore ? selected.at(-1)!.id : null,
      },
    };
  }
  private async inventoryEvent(
    tx: Prisma.TransactionClient,
    propertyId: string,
    roomTypeId: string,
    dto: RoomBlock,
    operation: string,
  ) {
    await tx.outbox_events.create({
      data: {
        event_type: 'InventoryChanged',
        aggregate_type: 'RoomBlock',
        aggregate_id: dto.id,
        payload_json: {
          propertyId,
          roomTypeId,
          roomId: dto.roomId,
          startDate: dto.startDate,
          endDate: dto.endDate,
          operation,
        },
      },
    });
  }
}
