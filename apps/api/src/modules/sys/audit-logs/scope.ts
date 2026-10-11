import { Prisma } from '@prisma/client';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
/** Only immutable, server-owned proofs; never join mutable actors/entities to grant historical scope. */
export function auditScope(actor: AuthorizedActor): Prisma.Sql {
  if (actor.role === 'OWNER') return Prisma.sql`true`;
  if (actor.propertyScope.length === 0) return Prisma.sql`false`;
  const proofs = [
    Prisma.sql`a.before_json->'propertyId'`,
    Prisma.sql`a.before_json->'property_id'`,
    Prisma.sql`a.after_json->'propertyId'`,
    Prisma.sql`a.after_json->'property_id'`,
    Prisma.sql`CASE WHEN a.entity_type='Property' THEN to_jsonb(a.entity_id::text) END`,
  ];
  const allowed = Prisma.sql`ARRAY[${Prisma.join([...actor.propertyScope])}]::text[]`;
  const present = proofs.map((p) => Prisma.sql`${p} IS NOT NULL`);
  const reference = Prisma.sql`COALESCE(${Prisma.join(proofs.map((p) => Prisma.sql`${p}#>>'{}'`))})`;
  const valid = proofs.map(
    (p) =>
      Prisma.sql`(${p} IS NULL OR (jsonb_typeof(${p})='string' AND (${p}#>>'{}')=ANY(${allowed}) AND (${p}#>>'{}')=${reference}))`,
  );
  return Prisma.sql`a.entity_type IN ('Property','RoomType','Room','RoomBlock','Booking','RateCalendar','Season','Promotion')
    AND (${Prisma.join(present, ' OR ')}) AND (${Prisma.join(valid, ' AND ')})`;
}
