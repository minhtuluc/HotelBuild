import { vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type {
  BookingRelocationOptions,
  OverbookingCaseDetail,
  RelocationPlan,
  RoomMove,
  RoomMoveView,
} from '@pinehill/contracts';
import { RelocationController } from '../../src/features/hb136-scr44-dieu-chuyen/controller';
import type { Params } from '../../src/features/hb136-scr44-dieu-chuyen/model';
import type {
  Actor,
  ApproveIntent,
  CreateIntent,
  ExecuteIntent,
  PlanIntent,
  RelocationPorts,
} from '../../src/features/hb136-scr44-dieu-chuyen/port';

export const MANAGER: Actor = { userId: 'u1', role: 'MANAGER', propertyScope: ['p1'] };
export const OWNER: Actor = { userId: 'u2', role: 'OWNER', propertyScope: ['p1'] };
export const DESK: Actor = { userId: 'u3', role: 'FRONT_DESK', propertyScope: ['p1'] };
export const ACCOUNTANT: Actor = { userId: 'u4', role: 'ACCOUNTANT', propertyScope: ['p1'] };

export const PARAMS: Params = {
  caseId: 'k1',
  bookingId: 'bk-1',
  bookingRoomId: 'br-1',
  moveId: '',
};

export const ladder: OverbookingCaseDetail['ladderPreview'] = [
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

type Candidate = OverbookingCaseDetail['candidates'][number];

export const candidate = (rank: number, name: string, total: number): Candidate => ({
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

export const detail = (rows: Candidate[] = []): OverbookingCaseDetail => ({
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
  compensationAmount: 300000,
  transportCost: 50000,
  consent: { granted: true, channel: 'PHONE' },
  approvedBy: null,
  approvedAt: null,
  status: 'PROPOSED',
  assignmentIds: [],
  walkOut: null,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  version: 3,
  allowedActions: ['APPROVE'],
  writeIntent: null,
  ...overrides,
});

export function roomMove(): RoomMove {
  const { allowedActions, writeIntent, ...rest } = moveView();
  return { ...rest, version: allowedActions.length + (writeIntent === null ? 0 : 1) };
}

const plan: RelocationPlan = {
  caseId: 'k1',
  propertyId: 'p1',
  date: '2026-11-20',
  roomTypeId: 'rt1',
  shortageCount: 2,
  status: 'PROPOSED',
  resolveDeadline: '2026-11-19T07:00:00.000Z',
  overdue: false,
  ladder,
  candidates: [],
  assignmentsChanged: false,
  generatedAt: '2026-11-10T01:00:00.000Z',
};

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

/** Kiểu `string | undefined` cho ETag mà không cần ép kiểu. */
export const tag = (value: string): string | undefined => value;

export const timeout = () => new ApiError({ kind: 'timeout', message: 'timeout' });

export function setup(actor: Actor = MANAGER, params: Params = PARAMS) {
  const ports = {
    actor: vi.fn(async (_signal: AbortSignal) => actor),
    caseDetail: vi.fn(async (_caseId: string) => ({
      detail: detail([candidate(1, 'A*** B', 40), candidate(2, 'C*** D', 55)]),
      etag: tag('"3"'),
    })),
    options: vi.fn(async (_b: string, _c: string, _key?: string) => optionsView()),
    move: vi.fn(async (_id: string, _key?: string) => ({
      view: moveView(),
      etag: tag('"3"'),
    })),
    plan: vi.fn(async (_intent: PlanIntent) => plan),
    create: vi.fn(async (_intent: CreateIntent) => roomMove()),
    approve: vi.fn(async (_intent: ApproveIntent) => roomMove()),
    execute: vi.fn(async (_intent: ExecuteIntent) => roomMove()),
    verifyPin: vi.fn(async (_pin: string, _bookingId: string) => undefined),
    clearPin: vi.fn(() => undefined),
  } satisfies RelocationPorts;
  let time = Date.parse('2026-11-10T00:00:00Z');
  let sequence = 0;
  const controller = new RelocationController({
    ports,
    params,
    newKey: () => `key-${(sequence += 1)}`,
    now: () => time,
  });
  return { ports, controller, advance: (ms: number) => (time += ms) };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
