import {
  housekeepingTaskQuerySchema,
  housekeepingTaskSchema,
  listResponseSchema,
} from '@pinehill/contracts';
import type { Session } from '../session';
import type { TaskPorts } from './reader';
export function taskPorts(session: Session): TaskPorts {
  return {
    actor: () => session.profile(),
    read: async (query, signal) =>
      (
        await session.resourceClient().request({
          method: 'GET',
          path: '/housekeeping/tasks',
          query: housekeepingTaskQuerySchema.parse(query),
          decoder: listResponseSchema(housekeepingTaskSchema.strict()),
          signal,
          maxAttempts: 1,
        })
      ).data,
  };
}
