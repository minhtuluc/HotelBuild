import type { Prisma } from '@prisma/client';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { propertyWhere } from '../../../common/rbac/scope.js';
import { invalid, validDate } from './validation.js';
import type { BlockListQuery } from './validation.js';
export function validateListRange(query: BlockListQuery): void {
  for (const date of [query.from, query.to])
    if (date !== undefined && !validDate(date)) throw invalid();
  if (query.from !== undefined && query.to !== undefined && query.from >= query.to) throw invalid();
}
export function listWhere(
  actor: AuthorizedActor,
  query: BlockListQuery,
): Prisma.room_blocksWhereInput {
  return {
    rooms: propertyWhere(actor, query.propertyId ? { property_id: query.propertyId } : {}),
    ...(query.roomId ? { room_id: query.roomId } : {}),
    ...(query.from ? { end_date: { gt: new Date(`${query.from}T00:00:00Z`) } } : {}),
    ...(query.to ? { start_date: { lt: new Date(`${query.to}T00:00:00Z`) } } : {}),
  };
}
