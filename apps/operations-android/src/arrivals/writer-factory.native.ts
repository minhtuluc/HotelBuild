/** Lắp `CheckInWriter` với phụ thuộc thật (NetInfo, expo-crypto) — chỉ import từ gốc ứng dụng. */
import { randomUUID } from 'expo-crypto';
import type { Session } from '../session';
import { netInfoSource } from '../netinfo-device.native';
import { sendCheckIn, sendInspection } from './ports';
import { CheckInWriter } from './writer';

export function createCheckInWriter(session: Session): CheckInWriter {
  const net = netInfoSource();
  return new CheckInWriter({
    online: () => net.getConnected(),
    createId: () => randomUUID(),
    send: (body, key) => sendCheckIn(session, body, key),
    inspect: (body, key) => sendInspection(session, body, key),
  });
}
