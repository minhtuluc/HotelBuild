/** Lắp writer chốt quỹ với phụ thuộc thật (NetInfo, expo-crypto) — chỉ import từ gốc ứng dụng. */
import { randomUUID } from 'expo-crypto';
import type { ReconciliationCloseResponse } from '@pinehill/contracts';
import type { Session } from '../session';
import { netInfoSource } from '../netinfo-device.native';
import { PinnedWriter } from '../stay/writer';
import type { CloseBody } from './model';
import { closePorts } from './ports';

export function createCloseWriter(
  session: Session,
): PinnedWriter<CloseBody, ReconciliationCloseResponse> {
  const net = netInfoSource();
  return new PinnedWriter(
    closePorts(session, { online: () => net.getConnected(), createId: () => randomUUID() }),
  );
}
