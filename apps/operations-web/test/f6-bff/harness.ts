/**
 * Hạ tầng chung của test BFF F6 (HB-217): API giả qua TCP thật + dựng `Request` như trình duyệt. Chạy trong
 * tiến trình `tsx --conditions=react-server` (nhà máy `web-session/server` chỉ nạp được ở điều kiện này).
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';

export const ORIGIN = 'https://ops.test';
export const KEY = 'babc0000-0000-4000-8000-000000000001';
export const BEARER = 'Bearer synthetic-access';

export interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface Reply {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface Fake {
  seen: Seen[];
  reply: (request: Seen) => Reply;
  close: () => Promise<void>;
}

/** API giả: ghi lại mọi yêu cầu; `reply` quyết định phản hồi (mặc định 200 `{}`), luôn kèm cookie riêng tư để thử cắt. */
export async function startFake(
  initial: (request: Seen) => Reply = () => ({ status: 200, body: {} }),
): Promise<Fake> {
  const fake: Fake = { seen: [], reply: initial, close: async () => undefined };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const seen: Seen = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      };
      fake.seen.push(seen);
      const reply = fake.reply(seen);
      res.writeHead(reply.status, {
        'content-type': 'application/json',
        'set-cookie': 'synthetic-private=hidden',
        ...reply.headers,
      });
      res.end(JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('TCP');
  delete process.env.SESSION_APP_ORIGIN;
  process.env.NEXT_PUBLIC_API_BASE_URL = `http://127.0.0.1:${address.port}/api/v1`;
  fake.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return fake;
}

export interface Options {
  body?: unknown;
  key?: string | null;
  tag?: string;
  csrf?: boolean;
  bearer?: boolean;
  rawBody?: string;
}

function headersFor(method: string, options: Options): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.bearer !== false) headers.set('authorization', BEARER);
  if (options.tag !== undefined) headers.set('if-match', options.tag);
  if (method === 'GET') return headers;
  if (options.csrf !== false) {
    headers.set('origin', ORIGIN);
    headers.set('x-session-request', '1');
  }
  if (options.key !== null) headers.set('idempotency-key', options.key ?? KEY);
  return headers;
}

/** Yêu cầu như trình duyệt gửi tới BFF: `Origin` + `X-Session-Request` cho lệnh ghi, khoá UUIDv4, bearer của phiên. */
export function browser(method: string, path: string, options: Options = {}): Request {
  const text =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(`${ORIGIN}/api/session/sys${path}`, {
    method,
    headers: headersFor(method, options),
    ...(text === undefined || method === 'GET' ? {} : { body: text }),
  });
}

/** Giá trị của một trường trong thân JSON (`undefined` nếu không phải đối tượng). */
export function fieldOf(body: string, name: string): unknown {
  const value: unknown = JSON.parse(body);
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))[name]
    : undefined;
}

export async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

const at = '2026-11-10T01:00:00.000Z';

/** Phản hồi hợp lệ theo hợp đồng, có thêm trường riêng tư để kiểm `decoder` cắt bỏ. */
export const sample = {
  mappingsView: {
    channelId: 'c1',
    version: 2,
    mapping: {
      id: 'm1',
      channelId: 'c1',
      roomTypeId: 'rt1',
      providerRoomTypeCode: 'OTA-1',
      allotmentPct: 40,
      externalRatePlanCode: null,
      status: 'ACTIVE',
      version: 2,
      updatedAt: at,
    },
    extra: 'synthetic-private',
  },
  operationRef: {
    operationId: 'op1',
    status: 'PENDING',
    statusUrl: '/api/v1/operations/op1',
    extra: 'synthetic-private',
  },
  resolved: {
    caseId: 'k1',
    status: 'RESOLVED',
    resolutionSource: 'USER',
    resolvedBy: 'u1',
    resolvedAt: at,
    resolutionNote: 'ok',
    auditLogId: 'a1',
    extra: 'synthetic-private',
  },
  roomMove: {
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
    createdAt: at,
    updatedAt: at,
    version: 3,
    extra: 'synthetic-private',
  },
  pinToken: { pinToken: 'synthetic-pin-token-0001', expiresAt: at },
  refundList: { data: [], meta: { limit: 20, nextCursor: null, hasMore: false, total: 0 } },
};

export function errorBody(code: string, extra: Record<string, unknown> = {}): Reply['body'] {
  return {
    code,
    message: 'synthetic-private-message',
    traceId: 'synthetic-private-trace',
    timestamp: at,
    path: '/api/v1/x',
    ...extra,
  };
}

export const done = (report: Record<string, unknown>): void => {
  process.stdout.write(JSON.stringify(report));
};
