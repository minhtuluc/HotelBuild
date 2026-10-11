import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import type { Update } from './validation.js';
import { forbidden } from './validation.js';
export function fieldPermissions(actor: AuthorizedActor, input: Update) {
  if (input.assignedTo !== undefined && !['MANAGER', 'OWNER'].includes(actor.role))
    throw forbidden();
  if (input.status === undefined) return;
  const permitted =
    actor.role === 'HOUSEKEEPING'
      ? ['IN_PROGRESS', 'DONE']
      : ['FRONT_DESK', 'MANAGER'].includes(actor.role)
        ? ['INSPECTED', 'PENDING']
        : [];
  if (!permitted.includes(input.status)) throw forbidden();
}
export function transition(from: string, to: string | undefined) {
  if (to === undefined) return;
  const edges: Readonly<Record<string, readonly string[]>> = {
    PENDING: ['IN_PROGRESS'],
    IN_PROGRESS: ['DONE'],
    DONE: ['INSPECTED', 'PENDING'],
    INSPECTED: ['PENDING'],
  };
  if (!edges[from]?.includes(to))
    throw new AppError(
      409,
      'E_FO_TASK_TRANSITION_NOT_ALLOWED',
      'Trạng thái nhiệm vụ không cho phép thao tác này.',
    );
}
