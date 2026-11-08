/**
 * Fixture + helper đọc tài liệu OpenAPI cho test hợp đồng F6 (HB-120).
 * Không phải test; giữ fixture ở một chỗ để 6 tệp spec dùng cùng số liệu api.md §3.9/§3.10/§5.1.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { serializeDocument } from '../../src/openapi/generate.js';

export type Json = Record<string, unknown>;

const jsonObjectSchema = z.record(z.string(), z.unknown());

/** `JSON.parse` trả `any`; chuẩn hoá qua zod để không dùng ép kiểu `as`. */
function parseJson(text: string): Json {
  const value: unknown = JSON.parse(text);
  const parsed = jsonObjectSchema.safeParse(value);
  if (!parsed.success) throw new Error('JSON không phải object');
  return parsed.data;
}

export function asObject(value: unknown): Json | undefined {
  if (Array.isArray(value)) return undefined;
  const parsed = jsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Tài liệu sinh từ zod, hạ về JSON để đọc bằng helper an toàn kiểu. */
export function documentJson(): Json {
  return parseJson(serializeDocument());
}

/** Đọc một tệp JSON (bản commit/baseline) thành object. */
export function readJsonFile(url: URL): Json {
  return parseJson(readFileSync(url, 'utf8'));
}

export function operationOf(doc: Json, path: string, method: string): Json | undefined {
  const item = asObject(asObject(doc.paths)?.[path]);
  return asObject(item?.[method]);
}

export function responseCodes(op: Json | undefined): string[] {
  return Object.keys(asObject(op?.responses) ?? {});
}

/** Tên tham số (path/query/header) của một operation. */
export function parameterNames(op: Json | undefined): string[] {
  const parameters = op?.parameters;
  if (!Array.isArray(parameters)) return [];
  const names: string[] = [];
  for (const raw of parameters) {
    const parameter = asObject(raw);
    if (typeof parameter?.name === 'string') names.push(parameter.name);
  }
  return names;
}

export function permissionsOf(op: Json | undefined): string[] {
  const value = op?.['x-permissions'];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function permissionEntry(
  entries: readonly { method: string; path: string; roles: readonly string[] }[],
  path: string,
  method: string,
): readonly string[] | undefined {
  return entries.find((entry) => entry.path === path && entry.method === method)?.roles;
}

export const IDEMPOTENCY_UUID = '3f1c8b52-6a4e-4f5a-9d2b-0c1e2f3a4b5c';
export const FIXED_TS = '2026-12-01T01:00:00Z';

export const LADDER = [
  {
    step: 1,
    moveType: 'SAME_TYPE_SAME_PROPERTY',
    feasible: false,
    candidateCount: 0,
    note: 'Không còn phòng cùng loại cùng cơ sở',
  },
  { step: 2, moveType: 'UPGRADE_SAME_PROPERTY', feasible: true, candidateCount: 3 },
  {
    step: 3,
    moveType: 'SAME_TYPE_CROSS_PROPERTY',
    feasible: false,
    candidateCount: 0,
    note: 'Bậc 3 không khả dụng: ba cơ sở cách nhau 160–300 km',
  },
  { step: 4, moveType: 'WALK_OUT', feasible: true, candidateCount: 2 },
];

export const CANDIDATE = {
  rank: 1,
  bookingId: 'b1',
  bookingRoomId: 'br1',
  bookingSeq: '1042',
  guestNameMasked: 'N*** V** A',
  channelCode: 'OTA_BOOKING',
  status: 'CONFIRMED',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: 2,
  adults: 2,
  children: 0,
  keepScore: {
    total: 14,
    loyaltyTier: 0,
    payment: 10,
    nights: 4,
    returningGuest: 0,
    arrived: 0,
  },
  priorityGroup: 'STRONG',
  createdAt: '2026-09-19T03:14:02Z',
  paidAmount: 800_000,
  depositAmount: 600_000,
  totalAmount: 2_000_000,
};

export const SCAN = {
  status: 'SUCCEEDED',
  lastSuccessAt: '2026-12-01T01:00:00Z',
  dataAsOf: '2026-12-01T01:00:00Z',
};

/** Ứng viên của chi tiết ca (HB-126/HB-220): `keepScore` số + `keepScoreBreakdown`. */
export const CASE_CANDIDATE = {
  rank: 1,
  bookingId: 'b1',
  bookingRoomId: 'br1',
  bookingSeq: '1042',
  guestNameMasked: 'N***',
  channelCode: 'WEB',
  status: 'CONFIRMED',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: 2,
  adults: 2,
  children: 0,
  keepScore: 24,
  keepScoreBreakdown: { loyalty: 0, payment: 20, nights: 4, repeat: 0, arrived: 0 },
  priorityGroup: 'STRONG',
  createdAt: '2026-11-20T03:00:00Z',
  paidAmount: 600_000,
  depositAmount: 600_000,
  totalAmount: 2_000_000,
};

export const CASE_SUMMARY = {
  id: 'c1',
  propertyId: 'p1',
  date: '2026-12-25',
  roomTypeId: 'rt1',
  roomTypeCode: 'DLX',
  shortageCount: 2,
  status: 'OPEN',
  detectedAt: '2026-12-01T01:00:00Z',
  resolveDeadline: '2026-12-24T07:00:00Z',
  escalatedAt: null,
  overdue: true,
  resolvedAt: null,
  resolvedBy: null,
  resolutionSource: null,
  delayReason: null,
  affectedBookingIds: ['b1', 'b2'],
  ladderPreview: LADDER,
  version: 1,
};

export const PLAN = {
  caseId: 'c1',
  propertyId: 'p1',
  date: '2026-12-25',
  roomTypeId: 'rt1',
  shortageCount: 2,
  status: 'PROPOSED',
  resolveDeadline: '2026-12-24T07:00:00Z',
  overdue: true,
  ladder: LADDER,
  candidates: [CANDIDATE],
  assignmentsChanged: false,
  generatedAt: '2026-12-01T02:00:00Z',
};

export const MOVE = {
  id: 'm1',
  overbookingCaseId: 'c1',
  bookingId: 'b1',
  bookingRoomId: 'br1',
  moveType: 'UPGRADE_SAME_PROPERTY',
  fromRoomId: 'r1',
  toRoomId: 'r2',
  fromPropertyId: 'p1',
  toPropertyId: 'p1',
  reason: 'Quá tải STD đêm 2026-12-25, nâng hạng DLX miễn phí',
  keepScore: 14,
  priceLocked: true,
  compensationAmount: 0,
  transportCost: 0,
  consent: { granted: true, channel: 'PHONE' },
  approvedBy: null,
  approvedAt: null,
  status: 'PROPOSED',
  assignmentIds: [],
  walkOut: null,
  createdAt: '2026-12-01T02:10:00Z',
  updatedAt: '2026-12-01T02:10:00Z',
  version: 1,
};

export const WALK_OUT = {
  walkOutDocNo: 'WO-2026-0001',
  guestSignatureRef: 'sig-guest-1',
  staffSignatureRef: 'sig-staff-1',
  refundRequestId: 'rr1',
  compensationPaymentId: null,
};

export const WRITE_INTENT = {
  idempotencyKey: IDEMPOTENCY_UUID,
  state: 'SUCCEEDED',
  resourceType: 'ROOM_MOVE',
  resourceId: 'm1',
  operationId: 'op1',
  recordedAt: '2026-12-01T02:10:00Z',
};

export const MOVE_VIEW = {
  ...MOVE,
  allowedActions: ['APPROVE', 'EXECUTE'],
  writeIntent: WRITE_INTENT,
};

export const MERGE_SHARE = {
  id: 'mg1',
  moveType: 'MERGE_SHARE',
  primaryBookingId: 'b1',
  secondaryBookingId: 'b2',
  roomId: 'r9',
  roomIdA: null,
  roomIdB: null,
  consentPrimary: true,
  consentSecondary: true,
  consents: [
    {
      side: 'PRIMARY',
      consented: true,
      evidenceUrl: 'https://evidence.pinehill.local/consent-1.pdf',
      recordedBy: 'u1',
      recordedAt: '2026-12-01T03:00:00Z',
    },
    {
      side: 'SECONDARY',
      consented: true,
      evidenceUrl: null,
      recordedBy: 'u1',
      recordedAt: '2026-12-01T03:05:00Z',
    },
  ],
  genderSame: true,
  approvedBy: null,
  approvedAt: null,
  discountPct: 20,
  discountAmount: 290_800,
  priceLocked: true,
  status: 'APPROVED',
  createdAt: '2026-12-01T03:00:00Z',
  updatedAt: '2026-12-01T03:10:00Z',
  version: 2,
};

export const MERGE_CONNECTING = {
  id: 'mg2',
  moveType: 'MERGE_CONNECTING',
  primaryBookingId: 'b1',
  secondaryBookingId: null,
  roomId: null,
  roomIdA: 'r1',
  roomIdB: 'r2',
  consentPrimary: false,
  consentSecondary: false,
  consents: [],
  genderSame: null,
  approvedBy: 'u2',
  approvedAt: '2026-12-01T03:20:00Z',
  discountPct: 10,
  discountAmount: 673_200,
  priceLocked: true,
  status: 'ACTIVE',
  createdAt: '2026-12-01T03:15:00Z',
  updatedAt: '2026-12-01T03:20:00Z',
  version: 3,
};

export const MAPPING = {
  id: 'map1',
  channelId: 'ch1',
  roomTypeId: 'rt1',
  providerRoomTypeCode: 'DLX-BK',
  allotmentPct: 80,
  externalRatePlanCode: 'FLEX7',
  status: 'ACTIVE',
  version: 1,
  updatedAt: '2026-12-01T04:00:00Z',
};

export const SYNC_STATUS = {
  channelId: 'ch1',
  syncStatus: 'OK',
  consecutiveFailures: 0,
  lastSyncAt: '2026-12-01T05:00:00Z',
  lastSuccessAt: '2026-12-01T05:00:00Z',
  lastVerifiedAt: '2026-12-01T05:00:05Z',
  lastError: null,
  history: [
    { at: '2026-12-01T04:45:00Z', outcome: 'FAILURE', error: 'E_CHAN_SYNC_FAILED' },
    { at: '2026-12-01T05:00:00Z', outcome: 'SUCCESS', error: null },
  ],
};

export const DELIVERY = {
  id: 'd1',
  eventId: 'ev1',
  eventType: 'inventory.changed',
  consumerKey: 'ota:booking',
  status: 'DEAD_LETTER',
  attempts: 5,
  lastError: 'E_CHAN_SYNC_FAILED',
  nextAttemptAt: null,
  createdAt: '2026-12-01T04:40:00Z',
  processedAt: null,
};

export const OTA_BOOKING = {
  id: 'inb1',
  channelId: 'ch1',
  eventType: 'booking.created',
  providerEventId: 'evt-1',
  providerBookingCode: 'BK-778812',
  status: 'PROCESSED',
  bookingId: 'b1',
  duplicate: false,
  flagged: true,
  flagReason: 'Nghi trùng với BK-778811',
  flaggedBy: 'u1',
  flaggedAt: '2026-12-01T06:00:00Z',
  oversold: true,
  guestNameMasked: 'N*** V** A',
  receivedAt: '2026-12-01T05:59:00Z',
  processedAt: '2026-12-01T06:00:10Z',
  errorCode: null,
  version: 2,
};

export const SALES_CLOSURE = {
  channelId: 'ch1',
  rows: [
    {
      roomTypeId: 'rt1',
      date: '2026-12-25',
      closed: true,
      closureSource: 'AUTOMATIC',
      manual: { closed: false, reason: null, closedAt: null, reopenedAt: null },
      automatic: {
        closed: true,
        reason: 'Tồn khả dụng ≤ 2 (BR-CHAN-05)',
        closedAt: '2026-12-01T00:00:00Z',
        reopenedAt: null,
      },
    },
  ],
};

export const WEBHOOK_EVENT = {
  eventType: 'booking.created',
  providerAccountId: 'acc-booking-vn',
  providerBookingCode: 'BK-778812',
  providerUpdatedAt: '2026-12-01T05:58:00Z',
  propertyCode: 'CS-01',
  roomTypeCode: 'DLX',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  adults: 2,
  children: 0,
  roomCount: 1,
  guest: { fullName: 'Nguyễn Văn A', phone: '0901234567' },
  amount: 2_842_000,
  currency: 'VND',
  paymentCollected: true,
};

export const COMPENSATION = {
  id: 'pay-c1',
  roomMoveId: 'm1',
  bookingId: 'b1',
  amount: 1_500_000,
  currency: 'VND',
  type: 'COMPENSATION',
  method: 'BANK_TRANSFER',
  state: 'PENDING',
  paymentStatus: 'PENDING',
  operationId: 'op-comp-1',
  approvalRef: { approvedBy: 'u2', approvedAt: '2026-12-01T07:00:00Z' },
  bankReference: 'FT26-0001',
  evidenceRefs: ['ev-1'],
  createdBy: 'u3',
  createdAt: '2026-12-01T07:10:00Z',
  paidAt: null,
};

export const ERROR_BODY = {
  code: 'E_GEN_PRECONDITION_REQUIRED',
  message: 'Cần phiên bản dữ liệu trước khi cập nhật.',
  traceId: '01HQ8Z3X7K9M2P4R6T8V0W1Y2A',
  timestamp: '2026-12-01T07:10:00Z',
  path: '/api/v1/room-moves/m1/approve',
};
