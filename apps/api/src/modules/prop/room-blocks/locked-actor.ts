import type { Prisma } from '@prisma/client';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { ScopeDeniedError } from '../../../common/rbac/scope.js';
import { forbidden } from './validation.js';

/** Recheck after inventory locks; hold the user and selected scope until the command commits. */
export async function assertLockedActor(
  tx: Prisma.TransactionClient,
  actor: AuthorizedActor,
  propertyId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.id}::uuid FOR SHARE`;
  const scopes = await tx.$queryRaw<
    { property_id: string }[]
  >`SELECT property_id FROM user_property_scopes WHERE user_id=${actor.id}::uuid AND property_id=${propertyId}::uuid FOR SHARE`;
  const user = await tx.users.findUnique({
    where: { id: actor.id },
    select: { role: true, is_active: true },
  });
  if (!user?.is_active || user.role !== actor.role) throw forbidden();
  if (actor.role !== 'OWNER' && scopes.length === 0) throw new ScopeDeniedError();
}
