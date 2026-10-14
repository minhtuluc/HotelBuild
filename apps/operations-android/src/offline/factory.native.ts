import { randomUUID } from 'expo-crypto';
import type { UserMe } from '@pinehill/contracts';
import type { Session } from '../session';
import { secureStorage } from '../storage.native';
import { netInfoSource } from '../netinfo.native';
import { OfflineQueue } from './queue';
import { offlineContext, offlinePorts } from './ports';

export function createOfflineQueue(session: Session, actor: UserMe): OfflineQueue {
  const storage = secureStorage();
  const ports = offlinePorts(session, storage);
  return new OfflineQueue({
    context: offlineContext(actor, session.selectedProperty()),
    storage,
    ...ports,
    createId: randomUUID,
    now: () => Date.now(),
    online: () => netInfoSource().getConnected(),
  });
}
