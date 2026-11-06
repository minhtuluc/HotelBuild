import { vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { ListPage, PropertySummary, RefundRequest } from '@pinehill/contracts';
import { ExceptionController } from '../../src/features/hb138-scr47-ngoai-le-policy/controller';
import type { Filter, Intent } from '../../src/features/hb138-scr47-ngoai-le-policy/model';
import type { Actor, ExceptionPorts } from '../../src/features/hb138-scr47-ngoai-le-policy/port';

export const MANAGER: Actor = { userId: 'u-mgr', role: 'MANAGER', propertyScope: ['p1'] };
export const OWNER: Actor = { userId: 'u-own', role: 'OWNER', propertyScope: ['p1'] };
export const DESK: Actor = { userId: 'u-desk', role: 'FRONT_DESK', propertyScope: ['p1'] };
export const ACCOUNTANT: Actor = { userId: 'u-acc', role: 'ACCOUNTANT', propertyScope: ['p1'] };

const property: PropertySummary = {
  id: 'p1',
  name: 'Synthetic Hill',
  status: 'ACTIVE',
  activeRoomCount: 20,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 1,
};

export const row = (id: string, overrides: Partial<RefundRequest> = {}): RefundRequest => ({
  id,
  bookingId: `bk-${id}`,
  paymentId: `pay-${id}`,
  policyId: 'pol-1',
  hoursBeforeCheckIn: 30,
  appliedTierId: 'tier-2',
  refundPercent: 100,
  requestedAmount: 500000,
  approvedAmount: null,
  refundFee: 0,
  netRefund: 500000,
  status: 'PENDING',
  isForceMajeure: true,
  reason: 'FORCE_MAJEURE',
  evidenceRefs: ['file-aaaa'],
  requestedBy: 'u-other',
  approvedBy: null,
  decidedAt: null,
  paidAt: null,
  createdAt: '2026-11-10T00:00:00.000Z',
  ...overrides,
});

export const page = (
  rows: RefundRequest[],
  next: string | null = null,
): ListPage<RefundRequest> => ({
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

export const timeout = () => new ApiError({ kind: 'timeout', message: 'timeout' });

export function setup(actor: Actor = MANAGER) {
  const ports = {
    actor: vi.fn(async (_signal: AbortSignal) => actor),
    properties: vi.fn(async (_signal: AbortSignal) => [property]),
    list: vi.fn(async (_filter: Filter, _cursor: string | undefined, _signal: AbortSignal) =>
      page([row('r1'), row('r2', { requestedBy: actor.userId })]),
    ),
    send: vi.fn(async (_intent: Intent) => undefined),
    verifyPin: vi.fn(async (_pin: string, _bookingId: string) => undefined),
    clearPin: vi.fn(() => undefined),
  } satisfies ExceptionPorts;
  let time = Date.parse('2026-11-10T00:00:00Z');
  let sequence = 0;
  const controller = new ExceptionController({
    ports,
    newKey: () => `key-${(sequence += 1)}`,
    now: () => time,
  });
  return { ports, controller, advance: (ms: number) => (time += ms) };
}

export const GOOD_NOTE = 'Bão làm đường đèo bị chặn hoàn toàn';
export const DRAFT = {
  bookingId: 'bk-9',
  paymentId: 'pay-9',
  reason: 'FORCE_MAJEURE' as const,
  note: GOOD_NOTE,
  evidence: 'file-aaaa, file-bbbb',
};

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
