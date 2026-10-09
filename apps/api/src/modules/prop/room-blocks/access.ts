import { z } from 'zod';
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { createInput, deleteReason, missing, uuid, forbidden, invalid } from './validation.js';
import { blockHistory } from './history.js';
@Injectable()
export class RoomBlockAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}
  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isAuthorizedActor(request.actor)) throw forbidden();
    const actor = request.actor;
    if (request.method === 'POST') {
      if (!actor.hasPermission('roomBlocks.create')) throw forbidden();
      const input = createInput(request.body);
      const room = await this.db.rooms.findUnique({
        where: { id: input.roomId },
        select: { property_id: true },
      });
      if (!room) throw missing();
      requireProperty(actor, room.property_id);
    } else {
      if (!actor.hasPermission('roomBlocks.remove')) throw forbidden();
      const id = this.deleteId(request);
      const block = await this.db.room_blocks.findUnique({
        where: { id },
        include: { rooms: { select: { property_id: true } } },
      });
      // A successful DELETE removed the row; immutable create history permits scoped replay.
      const property = block?.rooms.property_id ?? (await blockHistory(this.db, id)).propertyId;
      if (!property) throw missing();
      requireProperty(actor, property);
    }
    return { type: 'USER' as const, id: actor.id };
  }
  private deleteId(request: FastifyRequest): string {
    const params = z.object({ roomBlockId: z.uuid() }).safeParse(request.params);
    const query = z.object({ reason: z.unknown() }).safeParse(request.query);
    if (!params.success || !query.success) throw invalid();
    deleteReason(query.data.reason);
    return uuid(params.data.roomBlockId);
  }
}
