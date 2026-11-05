/**
 * Tiền kiểm `@Idempotent` cho `/room-merges`: thân lệnh + phạm vi cả hai booking/hai phòng trước khi
 * claim khoá; replay vẫn kiểm quyền (HB-125 AC3).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { actorOf, notFound, pathId, requireProperties } from '../support.js';
import { moveExecuteForAccess } from '../moves/validation.js';
import { mergeApproveInput, mergeConsentInput, mergeCreateInput } from './validation.js';

interface MergeScopeRow {
  primary_booking_id: string;
  secondary_booking_id: string | null;
  room_id: string;
  secondary_room_id: string | null;
}

/** Đủ phạm vi trên booking và phòng của một merge (SHARE hai booking, CONNECTING một booking). */
async function requireMergeScope(
  db: PrismaClient,
  request: FastifyRequest,
  mergeId: string,
): Promise<void> {
  const actor = actorOf(request);
  const rows = await db.$queryRaw<MergeScopeRow[]>`
    SELECT primary_booking_id, secondary_booking_id, room_id, secondary_room_id
      FROM room_merges WHERE id=${mergeId}::uuid`;
  const merge = rows[0];
  if (merge === undefined) throw notFound('Không tìm thấy lệnh ghép phòng.');
  const bookingIds = [merge.primary_booking_id, merge.secondary_booking_id].filter(
    (id): id is string => id !== null,
  );
  const bookings = await db.$queryRaw<
    { property_id: string }[]
  >`SELECT property_id FROM bookings WHERE id = ANY(${bookingIds}::uuid[])`;
  const roomIds = [merge.room_id, merge.secondary_room_id].filter(
    (id): id is string => id !== null,
  );
  const rooms = await db.$queryRaw<
    { property_id: string }[]
  >`SELECT property_id FROM rooms WHERE id = ANY(${roomIds}::uuid[])`;
  requireProperties(actor, [
    ...bookings.map((row) => row.property_id),
    ...rooms.map((row) => row.property_id),
  ]);
}

@Injectable()
export class MergeCreateAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = actorOf(request);
    const command = mergeCreateInput(request.body);
    const bookingIds =
      command.moveType === 'MERGE_SHARE'
        ? [command.primaryBookingId, command.secondaryBookingId]
        : [command.bookingId];
    const bookings = await this.db.$queryRaw<
      { property_id: string }[]
    >`SELECT property_id FROM bookings WHERE id = ANY(${bookingIds}::uuid[])`;
    if (bookings.length !== bookingIds.length) throw notFound('Không tìm thấy booking ghép.');
    const roomIds =
      command.moveType === 'MERGE_SHARE' ? [command.roomId] : [command.roomIdA, command.roomIdB];
    const rooms = await this.db.$queryRaw<
      { property_id: string }[]
    >`SELECT property_id FROM rooms WHERE id = ANY(${roomIds}::uuid[])`;
    if (rooms.length !== roomIds.length) throw notFound('Không tìm thấy phòng ghép.');
    requireProperties(actor, [
      ...bookings.map((row) => row.property_id),
      ...rooms.map((row) => row.property_id),
    ]);
    return { type: 'USER', id: actor.id };
  }
}

@Injectable()
export class MergeConsentAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = actorOf(request);
    mergeConsentInput(request.body);
    await requireMergeScope(this.db, request, pathId(request));
    return { type: 'USER', id: actor.id };
  }
}

@Injectable()
export class MergeApproveAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = actorOf(request);
    mergeApproveInput(request.body);
    await requireMergeScope(this.db, request, pathId(request));
    return { type: 'USER', id: actor.id };
  }
}

@Injectable()
export class MergeExecuteAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async authorize(context: ExecutionContext): Promise<Principal> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = actorOf(request);
    moveExecuteForAccess(request.body);
    await requireMergeScope(this.db, request, pathId(request));
    return { type: 'USER', id: actor.id };
  }
}
