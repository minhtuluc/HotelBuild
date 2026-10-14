import type { KeyValueStorage } from '../storage';
export type TaskTarget = 'IN_PROGRESS' | 'DONE';
export interface TaskIntent {
  owner: string;
  context: string;
  taskId: string;
  roomId: string;
  businessDate: string;
  version: number;
  target: TaskTarget;
  key: string;
  createdAt: number;
  review: boolean;
}
export const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validFields(value: Record<string, unknown>): boolean {
  return (
    uuid(value.owner) &&
    uuid(value.taskId) &&
    uuid(value.roomId) &&
    uuid(value.key) &&
    typeof value.context === 'string' &&
    typeof value.businessDate === 'string'
  );
}
function validValues(value: Record<string, unknown>): boolean {
  return (
    integer(value.version) &&
    value.version > 0 &&
    value.version < Number.MAX_SAFE_INTEGER &&
    integer(value.createdAt) &&
    value.createdAt >= 0 &&
    (value.target === 'IN_PROGRESS' || value.target === 'DONE')
  );
}
function isIntent(value: unknown): value is TaskIntent {
  if (!isRecord(value)) return false;
  const keys = [
    'owner',
    'context',
    'taskId',
    'roomId',
    'businessDate',
    'version',
    'target',
    'key',
    'createdAt',
    'review',
  ];
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((k) => keys.includes(k)) &&
    typeof value.review === 'boolean' &&
    validFields(value) &&
    validValues(value)
  );
}
export function parseIntent(raw: string): TaskIntent | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isIntent(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
export function withinReplayWindow(intent: TaskIntent, now: number): boolean {
  return (
    Number.isSafeInteger(now) && now >= intent.createdAt && now - intent.createdAt < 24 * 3600000
  );
}
export class PendingTaskIntent extends Error {}
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  // A predecessor's rejection belongs to its caller; it must not poison future operations.
  const work = previous.then(action, action);
  queues.set(key, work);
  const cleanup = () => {
    if (queues.get(key) === work) queues.delete(key);
  };
  void work.then(cleanup, cleanup);
  return work;
}
export const intentKey = (owner: string): string => 'housekeeping.pending.' + owner;
export function readPending(storage: KeyValueStorage, owner: string): Promise<string | null> {
  const key = intentKey(owner);
  return serialized(key, () => storage.get(key));
}
export function claimPending(storage: KeyValueStorage, intent: TaskIntent): Promise<void> {
  const key = intentKey(intent.owner),
    raw = JSON.stringify(intent);
  return serialized(key, async () => {
    const stored = await storage.get(key);
    if (stored !== null && stored !== raw) throw new PendingTaskIntent();
    await storage.set(key, raw);
  });
}
export function clearPending(storage: KeyValueStorage, intent: TaskIntent): Promise<void> {
  const key = intentKey(intent.owner);
  return serialized(key, async () => {
    if ((await storage.get(key)) !== JSON.stringify(intent)) throw new PendingTaskIntent();
    await storage.remove(key);
  });
}
export function markForReview(storage: KeyValueStorage, intent: TaskIntent): Promise<TaskIntent> {
  const key = intentKey(intent.owner),
    blocked = { ...intent, review: true };
  return serialized(key, async () => {
    if ((await storage.get(key)) !== JSON.stringify(intent)) throw new PendingTaskIntent();
    await storage.set(key, JSON.stringify(blocked));
    return blocked;
  });
}
