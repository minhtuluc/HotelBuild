import type { Prisma, PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { propertyWhere, requireProperty } from '../../../common/rbac/scope.js';
import { propertyQuery, roomQuery, typeQuery, page } from './queries.js';
import { invalid, missing } from './support.js';
import { propertyView, publicView, typeView, roomView } from './projection.js';
export const typeInclude = { rooms: { select: { bed_count: true, status: true } } } as const;
export const propertyInclude = {
  _count: { select: { rooms: { where: { status: 'ACTIVE' } } } },
} as const;
export async function roomToken(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<
    { version: bigint }[]
  >`SELECT (extract(epoch FROM updated_at)*1000000)::bigint AS version FROM rooms WHERE id=${id}::uuid`;
  if (!rows[0]) throw missing();
  return rows[0].version;
}
export class PropertyReads {
  constructor(readonly db: PrismaClient) {}
  properties(actor: AuthorizedActor | undefined, q: z.infer<typeof propertyQuery>) {
    return this.db.$transaction(
      async (tx) => {
        const where: Prisma.propertiesWhereInput = actor
          ? {
              AND: [
                q.status ? { status: q.status } : {},
                ...(actor.isOwner() ? [] : [{ id: { in: [...actor.propertyScope] } }]),
              ],
            }
          : { status: 'ACTIVE' };
        if (
          q.cursor &&
          !(await tx.properties.findFirst({ where: { AND: [where, { id: q.cursor }] } }))
        )
          throw invalid();
        const total = await tx.properties.count({ where });
        const rows = await tx.properties.findMany({
          where: { AND: [where, q.cursor ? { id: { gt: q.cursor } } : {}] },
          include: propertyInclude,
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        });
        return page(rows, total, q, actor ? propertyView : publicView);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async types(actor: AuthorizedActor, q: z.infer<typeof typeQuery>) {
    if (q.propertyId) requireProperty(actor, q.propertyId);
    return this.db.$transaction(
      async (tx) => {
        const where = propertyWhere(actor, q.propertyId ? { property_id: q.propertyId } : {});
        if (
          q.cursor &&
          !(await tx.room_types.findFirst({ where: { AND: [where, { id: q.cursor }] } }))
        )
          throw invalid();
        const total = await tx.room_types.count({ where });
        const rows = await tx.room_types.findMany({
          where: { AND: [where, q.cursor ? { id: { gt: q.cursor } } : {}] },
          include: typeInclude,
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        });
        return page(rows, total, q, typeView);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private async checkRoomType(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    q: z.infer<typeof roomQuery>,
  ) {
    if (q.roomTypeId) {
      const t = await tx.room_types.findUnique({ where: { id: q.roomTypeId } });
      if (!t) throw missing();
      requireProperty(actor, t.property_id);
      if (q.propertyId && q.propertyId !== t.property_id) throw invalid();
    }
  }
  async rooms(actor: AuthorizedActor, q: z.infer<typeof roomQuery>) {
    if (q.propertyId) requireProperty(actor, q.propertyId);
    return this.db.$transaction(
      async (tx) => {
        await this.checkRoomType(tx, actor, q);
        const where = propertyWhere(actor, {
          ...(q.propertyId ? { property_id: q.propertyId } : {}),
          ...(q.roomTypeId ? { room_type_id: q.roomTypeId } : {}),
          ...(q.status ? { status: q.status } : {}),
        });
        if (q.cursor && !(await tx.rooms.findFirst({ where: { AND: [where, { id: q.cursor }] } })))
          throw invalid();
        const total = await tx.rooms.count({ where });
        const rows = await tx.rooms.findMany({
          where: { AND: [where, q.cursor ? { id: { gt: q.cursor } } : {}] },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        });
        const views = await Promise.all(
          rows.map(async (row) => roomView(row, await roomToken(tx, row.id))),
        );
        return page(views, total, q, (x) => x);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
