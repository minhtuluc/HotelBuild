import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tokenPairSchema, type UserAccessUpdateRequest } from '@pinehill/contracts';
import { ApiClient } from '../src/client.js';
import { createAuthApi } from '../src/auth.js';
import { isApiError, type ApiError } from '../src/errors.js';

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  bodyText: string;
}

interface FixtureOutcome {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

const VALID_TOKENS = {
  tokenType: 'Bearer',
  accessToken: 'access-token-aaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'refresh-token-bbbbbbbb',
  refreshExpiresInSeconds: 604_800,
} as const;

function errorBody(code: string, message: string, path: string, traceId: string) {
  return { code, message, traceId, timestamp: '2026-10-01T00:00:00.000Z', path };
}

const requests: RecordedRequest[] = [];
let handler: (request: RecordedRequest, index: number) => FixtureOutcome;

async function readBody(socket: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => chunks.push(chunk));
  const { promise, resolve } = Promise.withResolvers<void>();
  socket.on('end', () => resolve());
  await promise;
  return Buffer.concat(chunks).toString('utf8');
}

function loginOutcome(request: RecordedRequest): FixtureOutcome {
  if (!request.bodyText.includes('"username":"blocked"')) {
    return { status: 200, body: VALID_TOKENS, headers: { 'x-trace-id': 'trace-200' } };
  }
  return {
    status: 401,
    headers: { 'x-trace-id': 'trace-401' },
    body: errorBody(
      'E_AUTH_INVALID_CREDENTIALS',
      'Sai thông tin đăng nhập',
      '/api/v1/auth/login',
      'trace-401',
    ),
  };
}

function accessOutcome(request: RecordedRequest): FixtureOutcome {
  const ifMatch = request.headers['if-match'];
  if (ifMatch === undefined) {
    return {
      status: 428,
      body: errorBody('E_GEN_PRECONDITION_REQUIRED', 'Thiếu If-Match', request.url, 't428'),
    };
  }
  if (ifMatch !== '"7"') {
    return {
      status: 412,
      body: errorBody('E_GEN_VERSION_CONFLICT', 'Phiên bản cũ', request.url, 't412'),
    };
  }
  return { status: 204 };
}

const ROUTES: Record<string, (request: RecordedRequest) => FixtureOutcome> = {
  'POST /api/v1/auth/login': loginOutcome,
  'PUT /api/v1/users/u1/access': accessOutcome,
  'POST /api/v1/auth/refresh': () => ({
    status: 200,
    body: { ...VALID_TOKENS, rotatedAt: '2026-10-01T00:00:00.000Z' },
  }),
  'POST /api/v1/auth/logout': () => ({ status: 204 }),
  'POST /api/v1/auth/pin/verify': () => ({
    status: 200,
    body: {
      pinToken: 'pin-token-aaaaaaaa',
      expiresAt: '2026-10-01T00:05:00.000Z',
      scopeHint: 'payments',
    },
  }),
  'POST /api/v1/guest-auth/register': () => ({
    status: 201,
    body: { ...VALID_TOKENS, loyaltyTier: 'GUEST' },
  }),
  'POST /api/v1/guest-auth/login': () => ({
    status: 200,
    body: { ...VALID_TOKENS, lastLoginAt: '2026-09-30T10:00:00.000Z' },
  }),
  'POST /api/v1/guest-auth/refresh': () => ({ status: 200, body: VALID_TOKENS }),
  'GET /api/v1/broken': () => ({ status: 500, body: { html: '<html>lỗi</html>' } }),
};

function defaultHandler(request: RecordedRequest): FixtureOutcome {
  const route = ROUTES[`${request.method} ${request.url}`];
  if (route !== undefined) return route(request);
  return { status: 200, body: { status: 'ok' } };
}

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    void (async () => {
      const bodyText = await readBody(request);
      const recorded: RecordedRequest = {
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: request.headers,
        bodyText,
      };
      const outcome = handler(recorded, requests.length);
      requests.push(recorded);
      response.writeHead(outcome.status, {
        'content-type': 'application/json',
        ...outcome.headers,
      });
      response.end(outcome.body === undefined ? '' : JSON.stringify(outcome.body));
    })();
  });
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => resolve());
  await promise;
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('không lấy được cổng fixture');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

afterAll(async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  server.close(() => resolve());
  await promise;
});

beforeEach(() => {
  requests.length = 0;
  handler = defaultHandler;
});

function makeClient(overrides: { getAccessToken?: () => string | null } = {}) {
  return new ApiClient({ baseUrl, fetchImpl: fetch, sleep: async () => undefined, ...overrides });
}

function recorded(index: number): RecordedRequest {
  const item = requests.at(index);
  if (item === undefined) throw new Error(`fixture chưa nhận yêu cầu thứ ${index}`);
  return item;
}

async function catchApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error('mong đợi ApiError');
}

describe('hợp đồng thật qua HTTP (fixture dựng từ schema của contracts)', () => {
  it('đăng nhập đi đúng đường dẫn, header và thân đã chuẩn hoá', async () => {
    const client = makeClient();
    const response = await createAuthApi(client).login({
      username: 'owner',
      password: 'matkhau123',
    });
    expect(response.data.accessToken).toBe(VALID_TOKENS.accessToken);
    expect(response.traceId).toBe('trace-200');
    const seen = recorded(0);
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/api/v1/auth/login');
    expect(seen.headers['idempotency-key']).toMatch(/[0-9a-f-]{36}/);
    expect(seen.headers['x-correlation-id']).toBeDefined();
    expect(seen.headers['content-type']).toBe('application/json');
    expect(seen.bodyText).toBe('{"username":"owner","password":"matkhau123"}');
  });

  it('ánh xạ lỗi 401 kèm traceId của body', async () => {
    const client = makeClient();
    const error = await catchApiError(
      createAuthApi(client).login({ username: 'blocked', password: 'matkhau123' }),
    );
    expect(error.status).toBe(401);
    expect(error.knownCode).toBe('E_AUTH_INVALID_CREDENTIALS');
    expect(error.traceId).toBe('trace-401');
    expect(error.message).toBe('Sai thông tin đăng nhập');
  });

  it('phát lại cùng khoá idempotency trả cờ replayed', async () => {
    handler = (_request: RecordedRequest, index: number) => {
      if (index === 0) return { status: 200, body: VALID_TOKENS };
      return {
        status: 200,
        body: VALID_TOKENS,
        headers: { 'idempotency-replayed': 'true', etag: '"3"' },
      };
    };
    const client = makeClient();
    await client.request({
      method: 'POST',
      path: '/auth/login',
      body: {},
      idempotencyKey: 'key-1',
      decoder: tokenPairSchema,
    });
    const second = await client.request({
      method: 'POST',
      path: '/auth/login',
      body: {},
      idempotencyKey: 'key-1',
      decoder: tokenPairSchema,
    });
    expect(second.replayed).toBe(true);
    expect(second.etag).toBe('"3"');
    expect(recorded(0).headers['idempotency-key']).toBe('key-1');
    expect(recorded(1).headers['idempotency-key']).toBe('key-1');
  });

  it('thiếu If-Match nhận 428, phiên bản cũ nhận 412, đúng phiên bản thành công', async () => {
    const api = createAuthApi(makeClient({ getAccessToken: () => 'session-token' }));
    const access: UserAccessUpdateRequest = {
      role: 'MANAGER',
      propertyScope: ['CS-01'],
      isActive: true,
    };
    const missing = await catchApiError(api.updateUserAccess('u1', access));
    expect(missing.knownCode).toBe('E_GEN_PRECONDITION_REQUIRED');
    expect(missing.status).toBe(428);
    const stale = await catchApiError(api.updateUserAccess('u1', access, '"6"'));
    expect(stale.knownCode).toBe('E_GEN_VERSION_CONFLICT');
    const ok = await api.updateUserAccess('u1', access, '"7"');
    expect(ok.status).toBe(204);
    expect(recorded(2).headers.authorization).toBe('Bearer session-token');
  });

  it('gửi lại qua mạng thật khi máy chủ bận, giữ nguyên khoá và mã tương quan', async () => {
    handler = (_request: RecordedRequest, index: number) =>
      index === 0
        ? {
            status: 503,
            body: errorBody('E_GEN_SERVICE_UNAVAILABLE', 'bận', '/api/v1/system/health', 't503'),
          }
        : { status: 200, body: VALID_TOKENS };
    const client = makeClient();
    const response = await client.request({
      method: 'POST',
      path: '/auth/login',
      body: { username: 'owner', password: 'matkhau123' },
      decoder: tokenPairSchema,
    });
    expect(response.status).toBe(200);
    expect(requests).toHaveLength(2);
    expect(recorded(1).headers['idempotency-key']).toBe(recorded(0).headers['idempotency-key']);
    expect(recorded(1).headers['x-correlation-id']).toBe(recorded(0).headers['x-correlation-id']);
  });

  it('luân chuyển refresh token giữ nguyên thân yêu cầu đã chuẩn hoá', async () => {
    const response = await createAuthApi(makeClient()).refresh('refresh-token-bbbbbbbb');
    expect(response.data.accessToken).toBe(VALID_TOKENS.accessToken);
    expect(recorded(0).bodyText).toBe('{"refreshToken":"refresh-token-bbbbbbbb"}');
  });

  it('logout trả 204 và không có thân', async () => {
    const response = await createAuthApi(makeClient()).logout();
    expect(response.status).toBe(204);
    expect(response.data).toBeUndefined();
    expect(recorded(0).url).toBe('/api/v1/auth/logout');
  });

  it('xác minh PIN gửi kèm bookingId khi có và đọc được pinToken', async () => {
    const api = createAuthApi(makeClient());
    const withBooking = await api.pinVerify('123456', 'booking-1');
    expect(withBooking.data.pinToken).toBe('pin-token-aaaaaaaa');
    expect(recorded(0).bodyText).toBe('{"pin":"123456","bookingId":"booking-1"}');
    const withoutBooking = await api.pinVerify('123456');
    expect(withoutBooking.data.expiresAt).toBe('2026-10-01T00:05:00.000Z');
    expect(recorded(1).bodyText).toBe('{"pin":"123456"}');
  });

  it('đăng ký khách trả 201 và thân yêu cầu theo schema contracts', async () => {
    const response = await createAuthApi(makeClient()).guestRegister({
      phone: '+84901234567',
      fullName: 'Nguyễn Văn A',
      password: 'matkhau123',
      consentMarketing: true,
      consentVersion: 'v1',
    });
    expect(response.status).toBe(201);
    expect(recorded(0).url).toBe('/api/v1/guest-auth/register');
    expect(recorded(0).bodyText).toContain('"phone":"+84901234567"');
  });

  it('đăng nhập và luân chuyển phiên khách đi đúng tuyến', async () => {
    const api = createAuthApi(makeClient());
    const login = await api.guestLogin('+84901234567', 'matkhau123');
    expect(login.status).toBe(200);
    expect(recorded(0).url).toBe('/api/v1/guest-auth/login');
    const rotated = await api.guestRefresh('refresh-token-bbbbbbbb');
    expect(rotated.data.refreshToken).toBe(VALID_TOKENS.refreshToken);
    expect(recorded(1).url).toBe('/api/v1/guest-auth/refresh');
  });

  it('trường lạ trong phản hồi không bị coi là lỗi giao thức (F0-02)', async () => {
    const api = createAuthApi(makeClient());
    const login = await api.login({ username: 'owner', password: 'matkhau123' });
    expect(login.data.accessToken).toBe(VALID_TOKENS.accessToken);
    const pin = await api.pinVerify('123456');
    expect(pin.data.pinToken).toBe('pin-token-aaaaaaaa');
    const guest = await api.guestLogin('+84901234567', 'matkhau123');
    expect(guest.data.refreshToken).toBe(VALID_TOKENS.refreshToken);
  });

  it('phản hồi 5xx không theo bao lỗi bị coi là lỗi giao thức', async () => {
    const client = makeClient();
    const error = await catchApiError(client.requestVoid({ method: 'GET', path: '/broken' }));
    expect(error.kind).toBe('protocol');
    expect(error.status).toBe(500);
  });
});
