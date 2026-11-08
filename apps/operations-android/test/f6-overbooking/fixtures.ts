import { vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type {
  BookingRelocationOptions,
  OverbookingAlertsView,
  OverbookingCaseDetail,
  OverbookingCaseList,
  OverbookingCaseSummary,
  OverbookingScanMetadata,
  RoomMove,
  RoomMoveView,
  UserMe,
} from '@pinehill/contracts';
import { RelocationFlow } from '../../src/features/f6-overbooking/flow';
import type { MoveContext } from '../../src/features/f6-overbooking/model';
import type { F6Ports, Loaded } from '../../src/features/f6-overbooking/ports';

export type Role = UserMe['role'];
export const CTX: MoveContext = { caseId: 'k1', bookingId: 'bk-1', bookingRoomId: 'br-1' };

export const okScan: OverbookingScanMetadata = {
  status: 'SUCCEEDED',
  lastSuccessAt: '2026-11-10T01:00:00.000Z',
  dataAsOf: '2026-11-10T01:00:00.000Z',
};

const ladder: OverbookingCaseDetail['ladderPreview'] = [
  { step: 1, moveType: 'SAME_TYPE_SAME_PROPERTY', feasible: true, candidateCount: 2 },
  { step: 2, moveType: 'UPGRADE_SAME_PROPERTY', feasible: true, candidateCount: 1 },
  {
    step: 3,
    moveType: 'SAME_TYPE_CROSS_PROPERTY',
    feasible: false,
    candidateCount: 0,
    note: 'Cơ sở cách nhau 160–300 km',
  },
  { step: 4, moveType: 'WALK_OUT', feasible: true, candidateCount: 1 },
];

export const summary = (
  overrides: Partial<OverbookingCaseSummary> = {},
): OverbookingCaseSummary => ({
  id: 'k1',
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
  ladderPreview: ladder,
  version: 3,
  ...overrides,
});

export const caseList = (rows: OverbookingCaseSummary[], scan = okScan): OverbookingCaseList => ({
  data: rows,
  meta: {
    limit: 50,
    nextCursor: null,
    hasMore: false,
    total: rows.length,
    overdueCount: rows.filter((row) => row.overdue).length,
    scan,
  },
});

export const alertList = (scan = okScan): OverbookingAlertsView => ({
  data: [
    {
      caseId: 'k1',
      bookingId: 'bk-1',
      propertyId: 'p1',
      roomTypeId: 'rt-std',
      date: '2026-11-20',
      status: 'OPEN',
      overdue: false,
      label: 'Thiếu 2 phòng ngày 2026-11-20',
      deepLink: '/bookings/bk-1?overbookingCaseId=k1',
    },
    {
      caseId: 'k1',
      bookingId: 'bk-2',
      propertyId: 'p1',
      roomTypeId: 'rt-std',
      date: '2026-11-20',
      status: 'OPEN',
      overdue: false,
      label: 'Thiếu 2 phòng ngày 2026-11-20',
      deepLink: '/bookings/bk-2?overbookingCaseId=k1',
    },
  ],
  meta: { limit: 50, nextCursor: null, hasMore: false, scan },
});

export const candidate = (
  rank: number,
  name: string,
  total: number,
): OverbookingCaseDetail['candidates'][number] => ({
  rank,
  bookingId: `bk-${rank}`,
  bookingRoomId: `br-${rank}`,
  bookingSeq: String(100 + rank),
  guestNameMasked: name,
  channelCode: 'WEB',
  status: 'CONFIRMED',
  checkIn: '2026-11-20',
  checkOut: '2026-11-22',
  nights: 2,
  adults: 2,
  children: 0,
  keepScore: total,
  keepScoreBreakdown: { loyalty: total - 14, payment: 10, nights: 4, repeat: 0, arrived: 0 },
  priorityGroup: rank === 1 ? 'WEAK' : 'STRONG',
  createdAt: '2026-11-01T00:00:00.000Z',
  paidAmount: 100000,
  depositAmount: 100000,
  totalAmount: 500000,
});

export const detail = (
  rows = [
    candidate(1, 'First*** A', 20),
    candidate(2, 'Second*** B', 80),
    candidate(3, 'Third*** C', 30),
  ],
): OverbookingCaseDetail => ({
  ...summary(),
  candidates: rows,
  history: [],
});

export const optionsView = (): BookingRelocationOptions => ({
  bookingId: 'bk-1',
  overbookingCaseId: 'k1',
  date: '2026-11-20',
  options: [
    {
      moveType: 'SAME_TYPE_SAME_PROPERTY',
      feasible: true,
      targetPropertyId: 'p1',
      targetRoomId: 'room-9',
      targetRoomTypeId: 'rt1',
      priceLocked: true,
      compensationAmount: 0,
      transportCost: 0,
    },
    {
      moveType: 'WALK_OUT',
      feasible: true,
      targetPropertyId: null,
      targetRoomId: null,
      targetRoomTypeId: null,
      priceLocked: true,
      compensationAmount: 300000,
      transportCost: 50000,
    },
  ],
  generatedAt: '2026-11-10T00:00:00.000Z',
  writeIntent: null,
});

export const moveView = (overrides: Partial<RoomMoveView> = {}): RoomMoveView => ({
  id: 'mv1',
  overbookingCaseId: 'k1',
  bookingId: 'bk-1',
  bookingRoomId: 'br-1',
  moveType: 'SAME_TYPE_SAME_PROPERTY',
  fromRoomId: 'room-1',
  toRoomId: 'room-9',
  fromPropertyId: 'p1',
  toPropertyId: 'p1',
  reason: 'Quá tải',
  keepScore: 40,
  priceLocked: true,
  compensationAmount: 0,
  transportCost: 0,
  consent: { granted: true, channel: 'IN_PERSON' },
  approvedBy: null,
  approvedAt: null,
  status: 'APPROVED',
  assignmentIds: [],
  walkOut: null,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  version: 3,
  allowedActions: ['EXECUTE'],
  writeIntent: null,
  ...overrides,
});

export function roomMove(): RoomMove {
  const { allowedActions, writeIntent, ...rest } = moveView();
  return { ...rest, version: allowedActions.length + (writeIntent === null ? 0 : 1) };
}

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
export const tag = (value: string): string | undefined => value;

export function ports(clock: { now: number } = { now: Date.parse('2026-11-10T00:00:00Z') }) {
  let sequence = 0;
  const fake = {
    now: () => new Date(clock.now),
    online: vi.fn(async () => true),
    createId: () => `key-${(sequence += 1)}`,
    cases: vi.fn(async (_property: string | undefined) => caseList([summary()])),
    alerts: vi.fn(async (_property: string | undefined) => alertList()),
    caseDetail: vi.fn(async (_id: string): Promise<Loaded<OverbookingCaseDetail>> => ({
      view: detail(),
      etag: tag('"3"'),
    })),
    options: vi.fn(async (_b: string, _c: string, _key?: string) => optionsView()),
    move: vi.fn(async (_id: string, _key?: string): Promise<Loaded<RoomMoveView>> => ({
      view: moveView(),
      etag: tag('"3"'),
    })),
    create: vi.fn(async (_body: unknown, _key: string) => roomMove()),
    approve: vi.fn(async (_id: string, _body: unknown, _pin: string, _etag: string, _key: string) =>
      roomMove(),
    ),
    execute: vi.fn(async (_id: string, _pin: string, _etag: string, _key: string) => roomMove()),
    verifyPin: vi.fn(async (_pin: string, _bookingId: string) => 'synthetic-pin-token-0001'),
  } satisfies F6Ports;
  return fake;
}

export function flowOf(role: Role, fake = ports()) {
  return { flow: new RelocationFlow(fake, role, CTX), fake };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
