import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { CompensationPaymentsView, RoomMergeView, RoomMoveView } from '@pinehill/contracts';
import { WalkOutController } from '../../src/features/hb137-scr45-46-ghep-walkout/controller';
import type { Intent, Params } from '../../src/features/hb137-scr45-46-ghep-walkout/model';
import type {
  Actor,
  Loaded,
  WalkOutPorts,
} from '../../src/features/hb137-scr45-46-ghep-walkout/port';

export const DESK: Actor = { userId: 'u1', role: 'FRONT_DESK', propertyScope: ['p1'] };
export const MANAGER: Actor = { userId: 'u2', role: 'MANAGER', propertyScope: ['p1'] };
export const OWNER: Actor = { userId: 'u3', role: 'OWNER', propertyScope: ['p1'] };
export const ACCOUNTANT: Actor = { userId: 'u4', role: 'ACCOUNTANT', propertyScope: ['p1'] };

export const PARAMS: Params = { mergeId: 'mg1', moveId: 'mv1' };

export const mergeView = (overrides: Partial<RoomMergeView> = {}): RoomMergeView => ({
  id: 'mg1',
  moveType: 'MERGE_SHARE',
  primaryBookingId: 'bk-1',
  secondaryBookingId: 'bk-2',
  roomId: 'room-1',
  roomIdA: null,
  roomIdB: null,
  consents: [],
  genderSame: true,
  approvedBy: null,
  approvedAt: null,
  discountPct: 20,
  discountAmount: 290800,
  priceLocked: true,
  status: 'PENDING_CONSENT',
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  version: 2,
  allowedActions: ['RECORD_CONSENT'],
  writeIntent: null,
  ...overrides,
});

export const moveView = (overrides: Partial<RoomMoveView> = {}): RoomMoveView => ({
  id: 'mv1',
  overbookingCaseId: 'k1',
  bookingId: 'bk-3',
  bookingRoomId: 'br-3',
  moveType: 'WALK_OUT',
  fromRoomId: 'room-3',
  toRoomId: null,
  fromPropertyId: 'p1',
  toPropertyId: null,
  reason: 'Quá tải',
  keepScore: 12,
  priceLocked: true,
  compensationAmount: 300000,
  transportCost: 50000,
  consent: { granted: true, channel: 'PHONE' },
  approvedBy: null,
  approvedAt: null,
  status: 'PROPOSED',
  assignmentIds: [],
  walkOut: {
    walkOutDocNo: 'WO-001',
    guestSignatureRef: 'sig-guest',
    staffSignatureRef: 'sig-staff',
    refundRequestId: 'rf-1',
    compensationPaymentId: null,
  },
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  version: 3,
  allowedActions: ['APPROVE'],
  writeIntent: null,
  ...overrides,
});

export const noPayments = (): CompensationPaymentsView => ({
  roomMoveId: 'mv1',
  approvedAmount: 300000,
  payments: [],
});

export const payment = (state: 'PENDING' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED') => ({
  id: 'pay-1',
  roomMoveId: 'mv1',
  bookingId: 'bk-3',
  amount: 300000,
  currency: 'VND' as const,
  type: 'COMPENSATION' as const,
  method: 'CASH' as const,
  state,
  paymentStatus: 'PENDING' as const,
  operationId: 'op-77',
  approvalRef: { approvedBy: 'u2', approvedAt: '2026-11-10T00:00:00.000Z' },
  bankReference: null,
  evidenceRefs: [],
  createdBy: 'u4',
  createdAt: '2026-11-10T00:00:00.000Z',
  paidAt: null,
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
/** Kiểu `string | undefined` cho ETag mà không cần ép kiểu. */
export const tag = (value: string): string | undefined => value;

export function setup(actor: Actor = DESK, params: Params = PARAMS) {
  const ports = {
    actor: vi.fn(async (_signal: AbortSignal) => actor),
    merge: vi.fn(async (_id: string, _key?: string): Promise<Loaded<RoomMergeView>> => ({
      view: mergeView(),
      etag: tag('"2"'),
    })),
    move: vi.fn(async (_id: string, _key?: string): Promise<Loaded<RoomMoveView>> => ({
      view: moveView(),
      etag: tag('"3"'),
    })),
    compensations: vi.fn(async (_moveId: string) => noPayments()),
    send: vi.fn(async (_intent: Intent): Promise<{ mergeId?: string }> => ({})),
    verifyPin: vi.fn(async (_pin: string, _bookingId: string) => undefined),
    clearPin: vi.fn(() => undefined),
  } satisfies WalkOutPorts;
  let time = Date.parse('2026-11-10T00:00:00Z');
  let sequence = 0;
  const controller = new WalkOutController({
    ports,
    params,
    newKey: () => `key-${(sequence += 1)}`,
    now: () => time,
  });
  return { ports, controller, advance: (ms: number) => (time += ms) };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Vai nào thấy nút duyệt walk-out trên điều chuyển PROPOSED (lễ tân chỉ thấy nút thực hiện). */
export const STAGES: readonly (readonly [Actor, readonly string[]])[] = [
  [MANAGER, ['hb137-move-approve']],
  [OWNER, ['hb137-move-approve']],
  [DESK, []],
  [ACCOUNTANT, []],
];

/** Nút chi bồi thường: chỉ ACCOUNTANT, điều chuyển đã duyệt, chưa có khoản chi đang/đã chạy. */
export const PAY_CASES: readonly (readonly [Actor, CompensationPaymentsView, boolean])[] = [
  [ACCOUNTANT, noPayments(), true],
  [MANAGER, noPayments(), false],
  [DESK, noPayments(), false],
  [ACCOUNTANT, { ...noPayments(), payments: [payment('UNKNOWN')] }, false],
  [ACCOUNTANT, { ...noPayments(), payments: [payment('SUCCEEDED')] }, false],
];

/** Ý định ghi do máy chủ báo khi tra theo khoá lệnh. */
export const writeIntentOf = (
  state: 'NOT_FOUND' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED',
): NonNullable<RoomMergeView['writeIntent']> => ({
  idempotencyKey: randomUUID(),
  state,
  resourceType: 'ROOM_MERGE',
  resourceId: state === 'SUCCEEDED' ? 'mg1' : null,
  operationId: null,
  recordedAt: state === 'SUCCEEDED' ? '2026-11-10T00:00:00.000Z' : null,
});

export const CONSENT = { side: 'PRIMARY' as const, consented: true, evidence: 'file-001' };

export const PAY = {
  method: 'CASH' as const,
  bankReference: '',
  note: 'Chi tiền mặt có biên nhận',
  evidence: '',
};
