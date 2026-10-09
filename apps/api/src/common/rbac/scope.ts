import type { AuthorizedActor } from '../actor/authorized-actor.js';
import { AppError } from '../app-error.js';

export interface GuestPrincipal {
  readonly type: 'GUEST';
  readonly id: string;
}
export class ScopeDeniedError extends AppError {
  constructor(guest = false) {
    super(
      guest ? 404 : 403,
      guest ? 'E_GEN_NOT_FOUND' : 'E_AUTH_OUT_OF_SCOPE',
      guest ? 'Không tìm thấy tài nguyên.' : 'Bạn không được truy cập dữ liệu của cơ sở này.',
    );
  }
}
export function requireProperty(actor: AuthorizedActor, propertyId: string): void {
  if (!actor.canActOn(propertyId)) throw new ScopeDeniedError();
}
/** AND prevents a caller's OR/property filter from overriding the mandatory database scope. */
export function propertyWhere<T extends object>(actor: AuthorizedActor, where: T) {
  return {
    AND: [
      where,
      ...(actor.isOwner()
        ? []
        : [{ property_id: { in: actor.role === 'SYSADMIN' ? [] : [...actor.propertyScope] } }]),
    ],
  };
}
export function guestOwnedWhere<T extends object>(principal: GuestPrincipal, where: T) {
  if (!principal.id) throw new ScopeDeniedError(true);
  return { AND: [where, { guest_id: principal.id }] };
}
export function requireScopedResult<T>(
  value: T | null,
  principal: AuthorizedActor | GuestPrincipal,
): T {
  if (value === null) throw new ScopeDeniedError('type' in principal && principal.type === 'GUEST');
  return value;
}
