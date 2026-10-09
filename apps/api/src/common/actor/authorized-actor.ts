import type { AuthenticatedActor } from './actor-context.js';

export interface PermissionLookup {
  allows(role: string, permission: string): boolean;
}
/** Business-use-case actor; the smaller ActorContext remains compatible with SYSTEM audit events. */
export interface AuthorizedActor extends AuthenticatedActor {
  readonly propertyScope: readonly string[];
  canActOn(propertyId: string): boolean;
  hasPermission(permission: string): boolean;
  isOwner(): boolean;
}
export function authorizeActor(
  actor: AuthenticatedActor,
  properties: readonly string[],
  permissions: PermissionLookup,
): AuthorizedActor {
  const scope = Object.freeze([...new Set(properties)]);
  const role = actor.role;
  return Object.freeze({
    ...actor,
    propertyScope: scope,
    canActOn: (propertyId: string) =>
      propertyId.length > 0 &&
      (role === 'OWNER' || (role !== 'SYSADMIN' && scope.includes(propertyId))),
    hasPermission: (permission: string) => permissions.allows(role, permission),
    isOwner: () => role === 'OWNER',
  });
}
export function isAuthorizedActor(actor: AuthenticatedActor | undefined): actor is AuthorizedActor {
  return (
    actor !== undefined &&
    'propertyScope' in actor &&
    'hasPermission' in actor &&
    typeof actor.hasPermission === 'function' &&
    'canActOn' in actor &&
    typeof actor.canActOn === 'function' &&
    'isOwner' in actor &&
    typeof actor.isOwner === 'function'
  );
}
