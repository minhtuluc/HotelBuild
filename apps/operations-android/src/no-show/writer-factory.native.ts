/** Lắp `NoShowWriter` với phụ thuộc thật (NetInfo, expo-crypto) — chỉ import từ gốc ứng dụng. */
import { randomUUID } from 'expo-crypto';
import type { Session } from '../session';
import { netInfoSource } from '../netinfo.native';
import { sendNoShow } from './ports';
import { NoShowWriter } from './writer';

export function createNoShowWriter(session: Session): NoShowWriter {
  const net = netInfoSource();
  return new NoShowWriter({
    online: () => net.getConnected(),
    createId: () => randomUUID(),
    send: (body, key) => sendNoShow(session, body, key),
  });
}
