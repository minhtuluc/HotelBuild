import { housekeepingTaskSchema, userMeSchema, type UserMe } from '@pinehill/contracts';
import type { Session } from '../session';
import type { KeyValueStorage } from '../storage';
import { QueueFailure, type QueueDeps, type OfflineContext, type QueueEntry } from './types';
import { parseContext } from './validation';
import { claimPending, clearPending, type TaskIntent } from '../housekeeping/intent';
import { verifyAck } from '../housekeeping/write-validation';
import { inReplayWindow } from './delivery';

export function offlineContext(actor: UserMe, propertyId: string | null): OfflineContext {
  return parseContext({
    userId: actor.userId,
    role: actor.role,
    propertyScope: actor.propertyScope,
    propertyId,
  });
}
function taskIntent(entry: QueueEntry): TaskIntent {
  const { action, context } = entry;
  if (action.kind !== 'HOUSEKEEPING_STATUS') throw new QueueFailure('UNSUPPORTED');
  if (context.role !== 'HOUSEKEEPING') throw new QueueFailure('CONTEXT_CHANGED');
  return {
    owner: context.userId,
    context: JSON.stringify([
      context.userId,
      context.role,
      [...context.propertyScope].sort(),
      context.propertyId,
    ]),
    taskId: action.taskId,
    roomId: action.roomId,
    businessDate: action.businessDate,
    version: action.version,
    target: action.status,
    key: entry.key,
    createdAt: entry.createdAt,
    review: false,
  };
}
export function offlinePorts(
  session: Session,
  storage: KeyValueStorage,
  now: () => number = () => Date.now(),
): Pick<QueueDeps, 'authorize' | 'send' | 'watch' | 'supports'> {
  return {
    supports: (action) => action.kind === 'HOUSEKEEPING_STATUS',
    authorize: async (signal) => {
      const result = await session.resourceClient().request({
        method: 'GET',
        path: '/auth/me',
        decoder: userMeSchema,
        signal,
        maxAttempts: 1,
      });
      return offlineContext(result.data, session.selectedProperty());
    },
    send: async (entry, signal) => {
      const intent = taskIntent(entry);
      // Share the existing owner lock; neither coordinator may acquire a second intent.
      await claimPending(storage, intent);
      let deadlineError: QueueFailure | undefined;
      const guard = () => {
        if (!inReplayWindow(entry, now())) {
          deadlineError = new QueueFailure('LOOKUP_REQUIRED');
          throw deadlineError;
        }
      };
      guard();
      const result = await session
        .resourceClient(guard)
        .request({
          method: 'PATCH',
          path: '/housekeeping/tasks/' + encodeURIComponent(intent.taskId),
          body: { status: intent.target },
          ifMatch: '"' + intent.version + '"',
          idempotencyKey: intent.key,
          decoder: housekeepingTaskSchema.strict(),
          signal,
          maxAttempts: 1,
        })
        .catch((error: unknown) => {
          throw deadlineError ?? error;
        });
      verifyAck(result, intent);
      await clearPending(storage, intent);
      return { key: entry.key, context: entry.context, action: entry.action, status: 'CONFIRMED' };
    },
    watch: (listener) => session.subscribe(listener),
  };
}
