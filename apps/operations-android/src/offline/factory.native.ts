import { randomUUID } from 'expo-crypto';
import type { UserMe } from '@pinehill/contracts';
import type { Session } from '../session';
import { secureStorage } from '../storage-device.native';
import { netInfoSource } from '../netinfo-device.native';
import { OfflineQueue } from './queue';
import { offlineContext, offlinePorts } from './ports';

export function createOfflineQueue(session: Session, actor: UserMe): OfflineQueue {
  const storage = secureStorage();
  const now = () => Date.now();
  const ports = offlinePorts(session, storage, now);
  return new OfflineQueue({
    context: offlineContext(actor, session.selectedProperty()),
    storage,
    ...ports,
    createId: randomUUID,
    now,
    online: () => netInfoSource().getConnected(),
  });
}
