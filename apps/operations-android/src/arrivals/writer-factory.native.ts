/** Lắp `CheckInWriter` với phụ thuộc thật (NetInfo, expo-crypto) — chỉ import từ gốc ứng dụng. */
import { randomUUID } from 'expo-crypto';
import type { Session } from '../session';
import { netInfoSource } from '../netinfo.native';
import { sendCheckIn } from './ports';
import { CheckInWriter } from './writer';

export function createCheckInWriter(session: Session): CheckInWriter {
  const net = netInfoSource();
  return new CheckInWriter({
    online: () => net.getConnected(),
    createId: () => randomUUID(),
    send: (body, key) => sendCheckIn(session, body, key),
  });
}
