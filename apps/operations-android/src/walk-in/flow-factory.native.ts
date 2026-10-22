/** Lắp `WalkInFlow` với phụ thuộc thật (NetInfo, expo-crypto) — chỉ import từ gốc ứng dụng. */
import { randomUUID } from 'expo-crypto';
import type { Session } from '../session';
import { netInfoSource } from '../netinfo.native';
import { WalkInFlow } from './flow';
import { walkInApiPorts } from './ports';

export function createWalkInFlow(session: Session): WalkInFlow {
  const net = netInfoSource();
  return new WalkInFlow({
    ...walkInApiPorts(session),
    online: () => net.getConnected(),
    now: () => Date.now(),
    createId: () => randomUUID(),
  });
}
