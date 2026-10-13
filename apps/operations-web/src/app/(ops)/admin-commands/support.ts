import { isApiError } from '@pinehill/api-client';
import type { UserMe } from '@pinehill/contracts';
import type { AdminCommand, AdminScope } from './intent';
export function denial(error: unknown): 'expired' | 'forbidden' | null {
  if (!isApiError(error)) return null;
  if (error.status === 401) return 'expired';
  return error.status === 403 ? 'forbidden' : null;
}
export function conflict(error: unknown): boolean {
  return isApiError(error) && (error.status === 412 || error.status === 428);
}
export function validation(error: unknown): boolean {
  return isApiError(error) && (error.status === 400 || error.status === 422);
}
export function writeAffordance(role: UserMe['role'], scope: AdminScope): boolean {
  return (
    role === 'OWNER' ||
    ((scope === 'connecting' || scope === 'room-block') && role === 'MANAGER') ||
    (scope === 'room-block' && role === 'FRONT_DESK')
  );
}

export function commandAllowed(
  canWrite: boolean,
  canRemove: boolean,
  command?: AdminCommand,
): boolean {
  return canWrite && (command?.kind !== 'room-block-delete' || canRemove);
}
