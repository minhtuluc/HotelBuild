/** Lắp writer 🔒 với phụ thuộc thật (NetInfo, expo-crypto) — chỉ import từ gốc ứng dụng. */
import { randomUUID } from 'expo-crypto';
import type { CheckOutResponse, Payment } from '@pinehill/contracts';
import type { Session } from '../session';
import { netInfoSource } from '../netinfo.native';
import type { CheckOutBody, CollectBody } from './model';
import { checkOutPorts, collectPorts, unlockPin } from './ports';
import { PinnedWriter } from './writer';

function shared(session: Session) {
  const net = netInfoSource();
  return {
    online: () => net.getConnected(),
    createId: () => randomUUID(),
    verifyPin: (pin: string, bookingId: string) => unlockPin(session, pin, bookingId),
  };
}

export function createCollectWriter(session: Session): PinnedWriter<CollectBody, Payment> {
  return new PinnedWriter(collectPorts(session, shared(session)));
}

export function createCheckOutWriter(
  session: Session,
): PinnedWriter<CheckOutBody, CheckOutResponse> {
  return new PinnedWriter(checkOutPorts(session, shared(session)));
}
