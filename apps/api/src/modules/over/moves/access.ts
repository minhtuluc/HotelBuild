/**
 * Tiền kiểm `@Idempotent` cho `/room-moves` (HB-029 README mục 1, HB-125 AC3): thân lệnh, phiên và
 * phạm vi nguồn/đích phải quyết **trước** khi claim khoá để replay vẫn kiểm quyền và lệnh hỏng
 * không để lại khoá rác.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { actorOf, notFound, pathId, requireProperties } from '../support.js';
import { moveApproveForAccess, moveCreateForAccess, moveExecuteForAccess } from './validation.js';

interface MoveScope {
  booking_id: string;
  from_property_id: string | null;
  to_property_id: string | null;
}

async function moveScope(db: PrismaClient, moveId: string): Promise<MoveScope> {
  const rows = await db.$queryRaw<MoveScope[]>`
    SELECT booking_id, from_property_id, to_property_id FROM room_moves WHERE id=${moveId}::uuid`;
  const row = rows[0];
  if (row === undefined) throw notFound('Không tìm thấy lệnh điều chuyển.');
  const booking = await db.$queryRaw<
    { property_id: string }[]
  >`SELECT property_id FROM bookings WHERE id=${row.booking_id}::uuid`;
  return { ...row, from_property_id: row.from_property_id ?? booking[0]?.property_id ?? null };
}

/** Người ghi phải có scope trên booking nguồn **và** cơ sở đích (BR-RBAC-02). */
async function requireMoveScope(
  db: PrismaClient,
  request: FastifyRequest,
  moveId: string,
): Promise<void> {
  const actor = actorOf(request);
  const move = await moveScope(db, moveId);
  requireProperties(actor, [move.from_property_id, move.to_property_id]);
}

@Injectable()
export class MoveCreateAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = actorOf(request);
    const command = moveCreateForAccess(request.body);
    const booking = await this.db.$queryRaw<
      { property_id: string }[]
    >`SELECT property_id FROM bookings WHERE id=${command.bookingId}::uuid`;
    if (booking[0] === undefined) throw notFound('Không tìm thấy booking.');
    requireProperties(actor, [booking[0].property_id]);
    if (command.toRoomId !== undefined) {
      const room = await this.db.$queryRaw<
        { property_id: string }[]
      >`SELECT property_id FROM rooms WHERE id=${command.toRoomId}::uuid`;
      if (room[0] === undefined) throw notFound('Không tìm thấy phòng đích.');
      requireProperties(actor, [room[0].property_id]);
    }
    return { type: 'USER', id: actor.id };
  }
}

@Injectable()
export class MoveApproveAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = actorOf(request);
    moveApproveForAccess(request.body);
    await requireMoveScope(this.db, request, pathId(request));
    return { type: 'USER', id: actor.id };
  }
}

@Injectable()
export class MoveExecuteAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = actorOf(request);
    moveExecuteForAccess(request.body);
    await requireMoveScope(this.db, request, pathId(request));
    return { type: 'USER', id: actor.id };
  }
}
