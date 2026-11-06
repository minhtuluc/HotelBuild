import { vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type {
  ChannelSummary,
  ChannelSyncStatusView,
  ListPage,
  OperationRef,
  OperationStatusView,
  OutboxDelivery,
} from '@pinehill/contracts';
import { SyncController } from '../../src/features/hb133-scr41-giam-sat-dong-bo/controller';
import type {
  Actor,
  DeliveryQuery,
  RetryIntent,
  SyncIntent,
  SyncPorts,
} from '../../src/features/hb133-scr41-giam-sat-dong-bo/port';

export const OWNER: Actor = { userId: 'u1', role: 'OWNER', propertyScope: ['p1'] };
export const MANAGER: Actor = { userId: 'u2', role: 'MANAGER', propertyScope: ['p1'] };
export const DESK: Actor = { userId: 'u3', role: 'FRONT_DESK', propertyScope: ['p1'] };

export const channel = (id: string): ChannelSummary => ({
  id,
  code: 'OTA_BOOKING',
  name: `Synthetic ${id}`,
  multiplier: 1,
  commissionPct: 15,
  holdMinutes: 30,
  overbookAllowed: false,
  version: 1,
});

export const statusView = (
  overrides: Partial<ChannelSyncStatusView> = {},
): ChannelSyncStatusView => ({
  channelId: 'c1',
  syncStatus: 'OK',
  consecutiveFailures: 0,
  lastSyncAt: '2026-11-10T01:00:00.000Z',
  lastSuccessAt: '2026-11-10T01:00:00.000Z',
  lastVerifiedAt: '2026-11-10T01:00:00.000Z',
  lastError: null,
  history: [],
  ...overrides,
});

export const delivery = (id: string, status: OutboxDelivery['status']): OutboxDelivery => ({
  id,
  eventId: `e-${id}`,
  eventType: 'inventory.changed',
  consumerKey: 'channel-sync',
  status,
  attempts: status === 'COMPLETED' ? 1 : 3,
  lastError: status === 'DEAD_LETTER' ? 'E_CHAN_SYNC_FAILED' : null,
  nextAttemptAt: null,
  createdAt: '2026-11-10T00:00:00.000Z',
  processedAt: status === 'COMPLETED' ? '2026-11-10T00:01:00.000Z' : null,
});

export const page = (
  rows: OutboxDelivery[],
  next: string | null = null,
): ListPage<OutboxDelivery> => ({
  data: rows,
  meta: { limit: 20, nextCursor: next, hasMore: next !== null, total: rows.length },
});

export function http(
  status: number,
  code: string,
  extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {},
) {
  return new ApiError({
    kind: 'http',
    status,
    code,
    message: 'PII Nguyen Van A',
    traceId: 'trace-1',
    ...extra,
  });
}

export const ref = (status: OperationRef['status'] = 'PENDING'): OperationRef => ({
  operationId: 'op1',
  status,
  statusUrl: '/api/v1/operations/op1',
});

export function setup(actor: Actor = MANAGER) {
  const ports = {
    actor: vi.fn(async (_signal: AbortSignal) => actor),
    channels: vi.fn(async (_signal: AbortSignal) => [channel('c1'), channel('c2')]),
    status: vi.fn(async (_id: string, _signal: AbortSignal) => statusView()),
    deliveries: vi.fn(async (_id: string, _query: DeliveryQuery, _signal: AbortSignal) =>
      page([delivery('d1', 'DEAD_LETTER'), delivery('d2', 'COMPLETED')]),
    ),
    sync: vi.fn(async (_intent: SyncIntent, _signal: AbortSignal) => ref()),
    retry: vi.fn(async (_intent: RetryIntent, _signal: AbortSignal) => ref()),
    operation: vi.fn(async (_id: string, _signal: AbortSignal): Promise<OperationStatusView> => ({
      operationId: 'op1',
      status: 'SUCCEEDED',
    })),
  } satisfies SyncPorts;
  let time = Date.parse('2026-11-10T00:00:00Z');
  let sequence = 0;
  // Mỗi lần poll chờ một cổng: test tự mở cổng để quan sát từng bước.
  const gates: (() => void)[] = [];
  const controller = new SyncController({
    ports,
    newKey: () => `key-${(sequence += 1)}`,
    now: () => time,
    wait: () => new Promise<void>((resolve) => gates.push(resolve)),
  });
  const tick = async () => {
    gates.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { ports, controller, tick, advance: (ms: number) => (time += ms) };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
