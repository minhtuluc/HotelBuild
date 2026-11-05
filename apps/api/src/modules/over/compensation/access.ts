/**
 * Tiền kiểm `@Idempotent` cho `POST /room-moves/{id}/compensation-payments` (F6-D06): thân lệnh +
 * phạm vi booking/cơ sở trước khi claim; PIN do service tiêu thụ trong transaction.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { actorOf, notFound, pathId, requireProperties } from '../support.js';
import { compensationInput } from './validation.js';

@Injectable()
export class CompensationAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = actorOf(request);
    compensationInput(request.body);
    const moveId = pathId(request);
    const rows = await this.db.$queryRaw<
      { booking_id: string; to_property_id: string | null }[]
    >`SELECT booking_id, to_property_id FROM room_moves WHERE id=${moveId}::uuid`;
    const move = rows[0];
    if (move === undefined) throw notFound('Không tìm thấy lệnh điều chuyển.');
    const booking = await this.db.$queryRaw<
      { property_id: string }[]
    >`SELECT property_id FROM bookings WHERE id=${move.booking_id}::uuid`;
    requireProperties(actor, [booking[0]?.property_id, move.to_property_id]);
    return { type: 'USER', id: actor.id };
  }
}
