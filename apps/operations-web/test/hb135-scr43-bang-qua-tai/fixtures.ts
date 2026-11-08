import { vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type {
  OverbookingCaseList,
  OverbookingCaseSummary,
  OverbookingResolveResponse,
  OverbookingScanMetadata,
  PropertySummary,
  RoomTypeSummary,
} from '@pinehill/contracts';
import { CaseController } from '../../src/features/hb135-scr43-bang-qua-tai/controller';
import type { Filter, Intent } from '../../src/features/hb135-scr43-bang-qua-tai/model';
import type { Actor, CasePorts } from '../../src/features/hb135-scr43-bang-qua-tai/port';

export const OWNER: Actor = { userId: 'u1', role: 'OWNER', propertyScope: ['p1'] };
export const MANAGER: Actor = { userId: 'u2', role: 'MANAGER', propertyScope: ['p1'] };
export const DESK: Actor = { userId: 'u3', role: 'FRONT_DESK', propertyScope: ['p1'] };

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

const roomType: RoomTypeSummary = {
  id: 'rt1',
  propertyId: 'p1',
  code: 'DOR',
  capacityAdults: 1,
  capacityChildren: 0,
  basePrice: 100000,
  minPrice: 100000,
  maxPrice: 100000,
  allowShared: true,
  bedCount: 6,
  version: 1,
};

export const caseRow = (
  id: string,
  overrides: Partial<OverbookingCaseSummary> = {},
): OverbookingCaseSummary => ({
  id,
  propertyId: 'p1',
  date: '2026-11-20',
  roomTypeId: 'rt1',
  roomTypeCode: 'DOR',
  shortageCount: 2,
  status: 'OPEN',
  detectedAt: '2026-11-10T00:00:00.000Z',
  resolveDeadline: '2026-11-19T07:00:00.000Z',
  escalatedAt: null,
  overdue: false,
  resolvedAt: null,
  resolvedBy: null,
  resolutionSource: null,
  delayReason: null,
  affectedBookingIds: ['bk-1'],
  ladderPreview: [
    { step: 1, moveType: 'SAME_TYPE_SAME_PROPERTY', feasible: true, candidateCount: 2 },
    { step: 2, moveType: 'UPGRADE_SAME_PROPERTY', feasible: true, candidateCount: 1 },
    {
      step: 3,
      moveType: 'SAME_TYPE_CROSS_PROPERTY',
      feasible: false,
      candidateCount: 0,
      note: 'Khác thành phố',
    },
    { step: 4, moveType: 'WALK_OUT', feasible: true, candidateCount: 1 },
  ],
  version: 3,
  ...overrides,
});

export const okScan: OverbookingScanMetadata = {
  status: 'SUCCEEDED',
  lastSuccessAt: '2026-11-10T01:00:00.000Z',
  dataAsOf: '2026-11-10T01:00:00.000Z',
};

export const page = (
  rows: OverbookingCaseSummary[],
  options: { next?: string | null; scan?: OverbookingScanMetadata; overdue?: number } = {},
): OverbookingCaseList => ({
  data: rows,
  meta: {
    limit: 20,
    nextCursor: options.next ?? null,
    hasMore: (options.next ?? null) !== null,
    total: rows.length,
    overdueCount: options.overdue ?? rows.filter((row) => row.overdue).length,
    scan: options.scan ?? okScan,
  },
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

const resolved: OverbookingResolveResponse = {
  caseId: 'k1',
  status: 'RESOLVED',
  resolutionSource: 'USER',
  resolvedBy: 'u2',
  resolvedAt: '2026-11-10T02:00:00.000Z',
  resolutionNote: 'Đã xử lý',
  auditLogId: 'a1',
};

export function setup(actor: Actor = MANAGER) {
  const ports = {
    actor: vi.fn(async (_signal: AbortSignal) => actor),
    catalogue: vi.fn(async (_signal: AbortSignal) => ({
      properties: [property],
      roomTypes: [roomType],
    })),
    list: vi.fn(async (_filter: Filter, _cursor: string | undefined, _signal: AbortSignal) =>
      page([caseRow('k1'), caseRow('k2')]),
    ),
    resolve: vi.fn(async (_intent: Intent) => resolved),
  } satisfies CasePorts;
  let time = Date.parse('2026-11-10T00:00:00Z');
  let sequence = 0;
  const controller = new CaseController({
    ports,
    newKey: () => `key-${(sequence += 1)}`,
    now: () => time,
  });
  return { ports, controller, advance: (ms: number) => (time += ms) };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
