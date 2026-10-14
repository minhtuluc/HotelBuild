import { validTaskDate } from '../housekeeping/reader';
import { QueueFailure, type OfflineAction, type OfflineContext, type QueueEntry } from './types';

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
export function uuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
const staffRoles = ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER', 'OWNER', 'ACCOUNTANT', 'SYSADMIN'];
export function parseContext(value: unknown): OfflineContext {
  if (!record(value) || !keys(value, ['userId', 'role', 'propertyId', 'propertyScope']))
    throw new QueueFailure('INVALID_CONTEXT');
  const { userId, role, propertyId, propertyScope } = value;
  if (!uuid(userId) || !uuid(propertyId) || typeof role !== 'string' || !staffRoles.includes(role))
    throw new QueueFailure('INVALID_CONTEXT');
  if (
    !Array.isArray(propertyScope) ||
    !propertyScope.every(uuid) ||
    !propertyScope.includes(propertyId)
  )
    throw new QueueFailure('INVALID_CONTEXT');
  return { userId, role, propertyId, propertyScope: [...new Set(propertyScope)].sort() };
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function validVersion(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value < Number.MAX_SAFE_INTEGER
  );
}
function calendar(value: unknown): value is string {
  return typeof value === 'string' && validTaskDate(value);
}
function housekeeping(value: Record<string, unknown>): OfflineAction {
  if (!keys(value, ['kind', 'taskId', 'roomId', 'businessDate', 'version', 'status']))
    throw new QueueFailure('INVALID_ACTION');
  const { taskId, roomId, businessDate, version, status } = value;
  if (!uuid(taskId) || !uuid(roomId) || !calendar(businessDate))
    throw new QueueFailure('INVALID_ACTION');
  if (!validVersion(version)) throw new QueueFailure('INVALID_ACTION');
  if (status !== 'IN_PROGRESS' && status !== 'DONE') throw new QueueFailure('INVALID_ACTION');
  return { kind: 'HOUSEKEEPING_STATUS', taskId, roomId, businessDate, version, status };
}
export function parseAction(value: unknown): OfflineAction {
  if (!record(value)) throw new QueueFailure('INVALID_ACTION');
  if (value.kind === 'HOUSEKEEPING_STATUS') return housekeeping(value);
  if (value.kind === 'NOTE_DRAFT' && keys(value, ['kind', 'text']) && text(value.text, 500))
    return { kind: 'NOTE_DRAFT', text: value.text };
  if (value.kind === 'SEARCH_DRAFT' && keys(value, ['kind', 'query']) && text(value.query, 100))
    return { kind: 'SEARCH_DRAFT', query: value.query };
  throw new QueueFailure('INVALID_ACTION');
}
export function binding(context: OfflineContext): string {
  return JSON.stringify(parseContext(context));
}
const phases = ['DRAFT', 'QUEUED', 'SENDING', 'CONFIRMED', 'NEEDS_REVIEW'] as const;
const reasons = [
  'UNKNOWN_RESULT',
  'CONFLICT',
  'AUTHORIZATION',
  'LOOKUP_REQUIRED',
  'UNSUPPORTED',
  'REJECTED',
] as const;
function phase(value: unknown): value is QueueEntry['phase'] {
  return phases.some((phase) => phase === value);
}
function reason(value: unknown): value is QueueEntry['reason'] {
  return value === null || reasons.some((reason) => reason === value);
}
function requestKey(value: unknown): string {
  if (!uuid(value) || value[14] !== '4') throw new QueueFailure('CORRUPT_STORAGE');
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new QueueFailure('CORRUPT_STORAGE');
  return value;
}
function coherent(
  phase: QueueEntry['phase'],
  attempted: boolean,
  reason: QueueEntry['reason'],
): boolean {
  if ((phase === 'NEEDS_REVIEW') !== (reason !== null)) return false;
  if (phase === 'DRAFT' && attempted) return false;
  return !(['SENDING', 'CONFIRMED'].includes(phase) && !attempted);
}
export function parseEntry(value: unknown): QueueEntry {
  if (
    !record(value) ||
    !keys(value, [
      'key',
      'context',
      'action',
      'createdAt',
      'phase',
      'attempted',
      'lastAttemptAt',
      'reason',
    ])
  )
    throw new QueueFailure('CORRUPT_STORAGE');
  const key = requestKey(value.key),
    createdAt = timestamp(value.createdAt);
  if (!phase(value.phase) || typeof value.attempted !== 'boolean' || !reason(value.reason))
    throw new QueueFailure('CORRUPT_STORAGE');
  const lastAttemptAt = value.lastAttemptAt === null ? null : timestamp(value.lastAttemptAt);
  if (lastAttemptAt !== null && lastAttemptAt < createdAt)
    throw new QueueFailure('CORRUPT_STORAGE');
  if (!coherent(value.phase, value.attempted, value.reason))
    throw new QueueFailure('CORRUPT_STORAGE');
  return {
    key,
    context: parseContext(value.context),
    action: parseAction(value.action),
    createdAt,
    phase: value.phase,
    attempted: value.attempted,
    lastAttemptAt,
    reason: value.reason,
  };
}
export function decode(raw: string | null, context: OfflineContext): QueueEntry[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 32) throw new QueueFailure('CORRUPT_STORAGE');
    parsed = parsed.map(parseEntry);
  } catch {
    throw new QueueFailure('CORRUPT_STORAGE');
  }
  // Re-checking the array guard narrows JSON's unknown value without assertions.
  if (!Array.isArray(parsed)) throw new QueueFailure('CORRUPT_STORAGE');
  const entries = parsed.map(parseEntry);
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length)
    throw new QueueFailure('CORRUPT_STORAGE');
  if (entries.some((entry) => binding(entry.context) !== binding(context)))
    throw new QueueFailure('CONTEXT_CHANGED');
  return entries;
}
