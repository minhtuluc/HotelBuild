import { housekeepingTaskSchema, userMeSchema } from '@pinehill/contracts';
import type { Session } from '../session';
import type { TaskWritePorts } from './writer';
export function taskWritePorts(session: Session): TaskWritePorts {
  return {
    watch: (listener) => session.subscribe(listener),
    property: () => session.selectedProperty(),
    actor: async (signal) =>
      (
        await session.resourceClient().request({
          method: 'GET',
          path: '/auth/me',
          decoder: userMeSchema,
          signal,
          maxAttempts: 1,
        })
      ).data,
    write: (intent, signal) =>
      session.resourceClient().request({
        method: 'PATCH',
        path: '/housekeeping/tasks/' + encodeURIComponent(intent.taskId),
        body: { status: intent.target },
        ifMatch: '"' + intent.version + '"',
        idempotencyKey: intent.key,
        decoder: housekeepingTaskSchema.strict(),
        signal,
        maxAttempts: 1,
      }),
  };
}
