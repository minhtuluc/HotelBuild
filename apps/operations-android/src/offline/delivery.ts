import { isApiError } from '@pinehill/api-client';
import type { QueueTransaction } from './repository';
import { QueueFailure, type QueueDeps, type QueueEntry, type ReviewReason } from './types';
import { binding, parseAction, parseContext, parseEntry, record } from './validation';

export function inReplayWindow(entry: QueueEntry, now: number): boolean {
  return (
    Number.isSafeInteger(now) &&
    now >= (entry.lastAttemptAt ?? entry.createdAt) &&
    now - entry.createdAt < 86_400_000
  );
}
async function abortable<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new QueueFailure('CONTEXT_CHANGED');
  let cancel = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(new QueueFailure('CONTEXT_CHANGED'));
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([action(), aborted]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
async function authorized(deps: QueueDeps, entry: QueueEntry, signal: AbortSignal): Promise<void> {
  const fresh = await abortable(signal, () => deps.authorize(signal));
  let valid = false;
  try {
    valid = binding(fresh) === binding(entry.context);
  } catch {
    /* A malformed authorization projection cannot authorize this intent. */
  }
  if (!valid) throw new QueueFailure('CONTEXT_CHANGED');
}
function matches(value: unknown, entry: QueueEntry): boolean {
  if (
    !record(value) ||
    Object.keys(value).length !== 4 ||
    value.status !== 'CONFIRMED' ||
    value.key !== entry.key
  )
    return false;
  try {
    return (
      binding(parseContext(value.context)) === binding(entry.context) &&
      JSON.stringify(parseAction(value.action)) === JSON.stringify(entry.action)
    );
  } catch {
    return false;
  }
}
function failure(error: unknown): ReviewReason {
  if (error instanceof QueueFailure) {
    if (error.code === 'CONTEXT_CHANGED') return 'AUTHORIZATION';
    if (error.code === 'UNSUPPORTED') return 'UNSUPPORTED';
    if (error.code === 'LOOKUP_REQUIRED') return 'LOOKUP_REQUIRED';
  }
  if (!isApiError(error) || error.kind !== 'http') return 'UNKNOWN_RESULT';
  if (error.code === 'E_SYS_REQUEST_IN_PROGRESS') return 'UNKNOWN_RESULT';
  return statusReason(error.status);
}
function statusReason(status: number | undefined): ReviewReason {
  if (status === 401 || status === 403) return 'AUTHORIZATION';
  if (status === 412 || status === 428) return 'CONFLICT';
  return [400, 404, 409, 422].includes(status ?? 0) ? 'REJECTED' : 'UNKNOWN_RESULT';
}
export async function deliver(
  tx: QueueTransaction,
  entry: QueueEntry,
  deps: QueueDeps,
  signal: AbortSignal,
  publish: (entries: QueueEntry[]) => void,
  invalidate: () => void,
): Promise<void> {
  const save = async (patch: Partial<QueueEntry>) => {
    await tx.save(
      tx.entries.map((current) => (current.key === entry.key ? { ...current, ...patch } : current)),
    );
    publish(tx.entries);
  };
  const review = async (reason: ReviewReason) => {
    if (reason === 'AUTHORIZATION') invalidate();
    await save({ phase: 'NEEDS_REVIEW', reason });
    if (reason === 'AUTHORIZATION') throw new QueueFailure('CONTEXT_CHANGED');
  };
  if (!(await abortable(signal, () => deps.online()))) return;
  try {
    await authorized(deps, entry, signal);
  } catch (error) {
    await review(failure(error));
    return;
  }
  if (!deps.supports(entry.action)) {
    await review('UNSUPPORTED');
    return;
  }
  if (!inReplayWindow(entry, deps.now())) {
    await reconcile(entry, deps, signal, save, review);
    return;
  }
  const prepared = parseEntry({
    ...entry,
    phase: 'SENDING',
    attempted: true,
    lastAttemptAt: deps.now(),
    reason: null,
  });
  await save(prepared);
  if (!inReplayWindow(prepared, deps.now())) {
    await reconcile(prepared, deps, signal, save, review);
    return;
  }
  let result: unknown;
  try {
    result = await abortable(signal, () => deps.send(parseEntry(prepared), signal));
    await authorized(deps, entry, signal);
  } catch (error) {
    await review(failure(error));
    return;
  }
  if (matches(result, entry)) await save({ phase: 'CONFIRMED', attempted: true, reason: null });
  else await review('UNKNOWN_RESULT');
}
async function reconcile(
  entry: QueueEntry,
  deps: QueueDeps,
  signal: AbortSignal,
  save: (patch: Partial<QueueEntry>) => Promise<void>,
  review: (reason: ReviewReason) => Promise<void>,
): Promise<void> {
  const lookup = deps.lookup;
  if (!lookup) {
    await review('LOOKUP_REQUIRED');
    return;
  }
  let result: unknown;
  try {
    result = await abortable(signal, () => lookup(parseEntry(entry), signal));
    await authorized(deps, entry, signal);
  } catch (error) {
    await review(failure(error) === 'AUTHORIZATION' ? 'AUTHORIZATION' : 'LOOKUP_REQUIRED');
    return;
  }
  if (matches(result, entry)) await save({ phase: 'CONFIRMED', attempted: true, reason: null });
  else await review('LOOKUP_REQUIRED');
}
