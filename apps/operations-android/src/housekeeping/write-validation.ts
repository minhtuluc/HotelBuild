import { isApiError, type ApiResponse } from '@pinehill/api-client';
import { housekeepingTaskSchema, type HousekeepingTask, type UserMe } from '@pinehill/contracts';
import { uuid, withinReplayWindow, type TaskIntent, type TaskTarget } from './intent';
import { validTaskDate } from './reader';
import type { TaskWriteDeps, TaskWritePhase } from './writer';
export class ContextChanged extends Error {}
export class InvalidTask extends Error {}
export function context(actor: UserMe, property: string | null): string {
  if (!uuid(actor.userId) || actor.role !== 'HOUSEKEEPING' || !actor.propertyScope.length)
    throw new ContextChanged();
  if (property !== null && !actor.propertyScope.includes(property)) throw new ContextChanged();
  return JSON.stringify([actor.userId, actor.role, [...actor.propertyScope].sort(), property]);
}
const rejections: Readonly<Record<string, { status: number; phase: TaskWritePhase }>> = {
  E_GEN_VERSION_CONFLICT: { status: 412, phase: 'conflict' },
  E_FO_TASK_TRANSITION_NOT_ALLOWED: { status: 409, phase: 'rejected' },
  E_GEN_VALIDATION_FAILED: { status: 400, phase: 'validation' },
  E_GEN_NOT_FOUND: { status: 404, phase: 'rejected' },
  E_AUTH_TOKEN_EXPIRED: { status: 401, phase: 'expired' },
  E_RBAC_FORBIDDEN: { status: 403, phase: 'forbidden' },
  E_RBAC_SCOPE_DENIED: { status: 403, phase: 'forbidden' },
};
export function rejection(error: unknown): TaskWritePhase | undefined {
  if (!isApiError(error) || error.kind !== 'http' || error.code === undefined) return undefined;
  const known = rejections[error.code];
  return known?.status === error.status ? known?.phase : undefined;
}
export function bindingCollision(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.code === 'E_SYS_IDEMPOTENCY_KEY_REUSED';
}
function validTask(task: HousekeepingTask, owner: string): boolean {
  return (
    housekeepingTaskSchema.strict().safeParse(task).success &&
    task.assignedTo === owner &&
    uuid(task.id) &&
    uuid(task.roomId) &&
    validTaskDate(task.businessDate) &&
    Number.isSafeInteger(task.version) &&
    task.version > 0 &&
    task.version < Number.MAX_SAFE_INTEGER
  );
}
export function verifyAck(result: ApiResponse<HousekeepingTask>, intent: TaskIntent): void {
  const row = result.data;
  const identity =
    row.id === intent.taskId &&
    row.roomId === intent.roomId &&
    row.businessDate === intent.businessDate;
  const version = Number.isSafeInteger(row.version) && row.version > intent.version;
  if (
    !identity ||
    !version ||
    row.assignedTo !== intent.owner ||
    row.status !== intent.target ||
    result.status !== 200 ||
    result.etag !== '"' + row.version + '"'
  )
    throw new Error('Invalid task acknowledgement');
}
export function newIntent(
  task: HousekeepingTask,
  target: TaskTarget,
  actor: UserMe,
  identity: string,
  deps: Pick<TaskWriteDeps, 'now' | 'createId'>,
): TaskIntent {
  if (!validTask(task, actor.userId) || !['IN_PROGRESS', 'DONE'].includes(target))
    throw new InvalidTask();
  const intent: TaskIntent = {
    owner: actor.userId,
    context: identity,
    taskId: task.id,
    roomId: task.roomId,
    businessDate: task.businessDate,
    version: task.version,
    target,
    key: deps.createId(),
    createdAt: deps.now(),
    review: false,
  };
  if (
    !/^........-....-4...-[89ab]...-............$/i.test(intent.key) ||
    !uuid(intent.key) ||
    !withinReplayWindow(intent, deps.now())
  )
    throw new InvalidTask();
  return intent;
}
