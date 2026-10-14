import { randomUUID } from 'expo-crypto';
import { secureStorage } from '../storage.native';
import type { Session } from '../session';
import { taskWritePorts } from './write-ports';
import { TaskWriter } from './writer';
export function createTaskWriter(session: Session): TaskWriter {
  return new TaskWriter({
    ...taskWritePorts(session),
    storage: secureStorage(),
    createId: () => randomUUID(),
    now: () => Date.now(),
  });
}
