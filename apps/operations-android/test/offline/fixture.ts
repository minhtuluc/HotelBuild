import { memoryStorage } from '../../src/storage';
import type { QueueDeps, OfflineContext, QueueReceipt } from '../../src/offline/types';
import { OfflineQueue } from '../../src/offline/queue';

export const context: OfflineContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'HOUSEKEEPING',
  propertyId: '22222222-2222-4222-8222-222222222222',
  propertyScope: ['22222222-2222-4222-8222-222222222222'],
};
export const action = {
  kind: 'HOUSEKEEPING_STATUS',
  taskId: '33333333-3333-4333-8333-333333333333',
  roomId: '44444444-4444-4444-8444-444444444444',
  businessDate: '2026-11-01',
  version: 7,
  status: 'IN_PROGRESS',
} as const;
export const key = '55555555-5555-4555-8555-555555555555';
export const storedKey =
  'offline.queue.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222';
export function fixture(overrides: Partial<QueueDeps> = {}) {
  const storage = memoryStorage();
  const sent: unknown[] = [];
  const clock = { value: 1000 };
  let next = 0;
  const deps: QueueDeps = {
    context,
    storage,
    createId: () => `55555555-5555-4555-8555-${String(555555555555 + next++)}`,
    now: () => clock.value,
    online: async () => true,
    supports: () => true,
    authorize: async () => context,
    send: async (entry) => {
      sent.push(entry);
      const receipt: QueueReceipt = {
        key: entry.key,
        context: entry.context,
        action: entry.action,
        status: 'CONFIRMED',
      };
      return receipt;
    },
    ...overrides,
  };
  return { queue: new OfflineQueue(deps), deps, storage: deps.storage, sent, clock };
}
