/** Hạ tầng test transport F6 (HB-120): HTTP server thật + fixture phản hồi, tách khỏi tệp spec. */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { ApiClient } from '../../src/client.js';

export interface Recorded {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  bodyText: string;
}

export interface Outcome {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export const requests: Recorded[] = [];
let plan: Record<string, Outcome | Outcome[]> = {};
let counters: Record<string, number> = {};
let server: Server | undefined;
export let baseUrl = '';

/** Kịch bản phản hồi theo `"METHOD /path?query"`; mảng = trả lần lượt cho các lần gọi. */
export function respond(next: Record<string, Outcome | Outcome[]>): void {
  plan = next;
  counters = {};
}

export function resetRequests(): void {
  requests.length = 0;
}

export async function startServer(): Promise<void> {
  server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      const done = Promise.withResolvers<void>();
      request.on('end', done.resolve);
      await done.promise;
      const recorded: Recorded = {
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: request.headers,
        bodyText: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(recorded);
      const key = `${recorded.method} ${recorded.url}`;
      const entry = plan[key];
      let outcome: Outcome = { status: 404 };
      if (Array.isArray(entry)) {
        const index = counters[key] ?? 0;
        counters[key] = index + 1;
        outcome = entry[Math.min(index, entry.length - 1)] ?? { status: 404 };
      } else if (entry !== undefined) outcome = entry;
      response.writeHead(outcome.status, {
        'content-type': 'application/json',
        ...outcome.headers,
      });
      response.end(outcome.body === undefined ? '' : JSON.stringify(outcome.body));
    })();
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', listening.resolve);
  await listening.promise;
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('không lấy được cổng fixture');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
}

export async function stopServer(): Promise<void> {
  if (server === undefined) return;
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
  server = undefined;
}

export function createClient(): ApiClient {
  return new ApiClient({
    baseUrl,
    getAccessToken: () => 'access-token',
    getPinToken: () => 'pin-token-aaaaaaaaaaaaaaaa',
    maxAttempts: 3,
    baseRetryDelayMs: 1,
    maxRetryDelayMs: 1,
  });
}

export const idempotencyUuid = randomUUID();
/** Dựng options có `Idempotency-Key` mà không lặp cặp khoá/giá trị trong từng ca test. */
export const withIdempotency = (key: string) => ({ idempotencyKey: key });
export const idempotencyUuid2 = randomUUID();
export const PIN = 'pin-token-aaaaaaaaaaaaaaaa';
export const TS = '2026-12-01T02:00:00Z';

export const OPERATION_REF = {
  operationId: 'op1',
  status: 'PENDING',
  statusUrl: '/api/v1/operations/op1',
};
export const OPERATION_STATUS = {
  operationId: 'op1',
  status: 'SUCCEEDED',
  resultRef: 'channel:ch1',
};

export const SYNC_STATUS = {
  channelId: 'ch1',
  syncStatus: 'OK',
  consecutiveFailures: 0,
  lastSyncAt: TS,
  lastSuccessAt: TS,
  lastVerifiedAt: TS,
  lastError: null,
  history: [{ at: TS, outcome: 'SUCCESS', error: null }],
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
  createdAt: TS,
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
  flagReason: 'Nghi trùng mã OTA',
  flaggedBy: 'u1',
  flaggedAt: TS,
  oversold: true,
  guestNameMasked: 'N*** V** A',
  receivedAt: TS,
  processedAt: TS,
  errorCode: null,
  version: 2,
};

export const MOVE = {
  id: 'm1',
  overbookingCaseId: 'c1',
  bookingId: 'b1',
  bookingRoomId: 'br1',
  moveType: 'UPGRADE_SAME_PROPERTY' as const,
  fromRoomId: 'r1',
  toRoomId: 'r2',
  fromPropertyId: 'p1',
  toPropertyId: 'p1',
  reason: 'Quá tải STD',
  keepScore: 14,
  priceLocked: true,
  compensationAmount: 0,
  transportCost: 0,
  consent: { granted: true, channel: 'PHONE' as const },
  approvedBy: null,
  approvedAt: null,
  status: 'PROPOSED',
  assignmentIds: [],
  walkOut: null,
  createdAt: TS,
  updatedAt: TS,
  version: 1,
};

export const MOVE_CREATE = {
  overbookingCaseId: 'c1',
  bookingId: 'b1',
  bookingRoomId: 'br1',
  moveType: 'UPGRADE_SAME_PROPERTY' as const,
  toRoomId: 'r2',
  reason: 'Quá tải STD',
  compensationAmount: 0,
  transportCost: 0,
  consent: { granted: true, channel: 'PHONE' as const },
};

export const WRITE_INTENT = {
  idempotencyKey: idempotencyUuid,
  state: 'SUCCEEDED',
  resourceType: 'ROOM_MOVE',
  resourceId: 'm1',
  operationId: 'op1',
  recordedAt: TS,
};

export const MOVE_VIEW = {
  ...MOVE,
  allowedActions: ['APPROVE', 'EXECUTE'],
  writeIntent: WRITE_INTENT,
};

export const MERGE_VIEW = {
  id: 'mg1',
  moveType: 'MERGE_SHARE',
  primaryBookingId: 'b1',
  secondaryBookingId: 'b2',
  roomId: 'r9',
  roomIdA: null,
  roomIdB: null,
  consents: [],
  genderSame: true,
  approvedBy: null,
  approvedAt: null,
  discountPct: 20,
  discountAmount: 290_800,
  priceLocked: true,
  status: 'APPROVED',
  createdAt: TS,
  updatedAt: TS,
  version: 2,
  allowedActions: ['RECORD_CONSENT', 'APPROVE'],
  writeIntent: null,
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
  approvalRef: { approvedBy: 'u2', approvedAt: TS },
  bankReference: 'FT26-0001',
  evidenceRefs: ['ev-1'],
  createdBy: 'u3',
  createdAt: TS,
  paidAt: null,
};

export const SCAN = {
  scanStatus: 'OK',
  lastSuccessfulScanAt: TS,
  nextScanAt: TS,
  scannedThrough: '2026-12-31',
};

export const ALERTS = {
  data: [
    {
      caseId: 'c1',
      propertyId: 'p1',
      date: '2026-12-25',
      shortageCount: 2,
      status: 'OPEN',
      overdue: true,
      resolveDeadline: '2026-12-24T07:00:00Z',
      bookings: [
        {
          bookingId: 'b1',
          bookingRoomId: 'br1',
          guestNameMasked: 'N*** V** A',
          checkIn: '2026-12-24',
          checkOut: '2026-12-26',
        },
      ],
      links: [{ rel: 'ROOM_MOVE', href: '/api/v1/room-moves' }],
    },
  ],
  meta: { limit: 20, nextCursor: null, hasMore: false, scan: SCAN },
};

export const RELOCATION_OPTIONS = {
  bookingId: 'b1',
  overbookingCaseId: 'c1',
  date: '2026-12-25',
  options: [],
  generatedAt: TS,
  writeIntent: null,
};

export const COMPENSATION_VIEW = {
  roomMoveId: 'm1',
  approvedAmount: 1_500_000,
  payments: [COMPENSATION],
};

export function errorBody(code: string, message: string): Record<string, unknown> {
  return {
    code,
    message,
    traceId: '01HQ8Z3X7K9M2P4R6T8V0W1Y2A',
    timestamp: TS,
    path: '/api/v1/room-moves/m1/approve',
  };
}
