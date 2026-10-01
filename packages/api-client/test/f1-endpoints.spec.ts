/**
 * Hợp đồng F1 qua HTTP thật (QĐ-03 T6): 7 endpoint mới của `api-client` và quy tắc
 * không tự gửi lại cho `POST /users` + `DELETE …/pin` (QĐ-03 T9).
 * Tách khỏi `contract.spec.ts` để mỗi tệp test giữ dưới 400 dòng (QT §2.6).
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateUserRequest } from '@pinehill/contracts';
import { ApiClient } from '../src/client.js';
import { createAuthApi } from '../src/auth.js';
import { createUsersApi } from '../src/users.js';
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
}

const USER_SUMMARY = {
  id: 'u1',
  username: 'letan01',
  fullName: 'Lễ tân 01',
  role: 'FRONT_DESK',
  propertyScope: ['p1'],
  isActive: true,
  lockedUntil: null,
  hasPin: false,
  version: 3,
};

function errorBody(code: string, message: string, path: string, traceId: string) {
  return { code, message, traceId, timestamp: '2026-10-02T00:00:00.000Z', path };
}

const requests: RecordedRequest[] = [];
let handler: (request: RecordedRequest) => FixtureOutcome;

async function readBody(socket: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => chunks.push(chunk));
  const { promise, resolve } = Promise.withResolvers<void>();
  socket.on('end', () => resolve());
  await promise;
  return Buffer.concat(chunks).toString('utf8');
}

const ROUTES: Record<string, (request: RecordedRequest) => FixtureOutcome> = {
  'GET /api/v1/users?limit=20&role=MANAGER': () => ({
    status: 200,
    body: { data: [USER_SUMMARY], meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 } },
  }),
  'POST /api/v1/users': (request) =>
    request.bodyText.includes('"username":"letan01"')
      ? {
          status: 409,
          body: errorBody('E_AUTH_USERNAME_TAKEN', 'Tên đã dùng', request.url, 't409'),
        }
      : { status: 201, body: USER_SUMMARY },
  'DELETE /api/v1/users/u1/pin': () => ({ status: 204 }),
  'POST /api/v1/auth/password': () => ({ status: 204 }),
  'PUT /api/v1/auth/pin': () => ({ status: 204 }),
  'POST /api/v1/guest-auth/password-reset/request': () => ({ status: 202 }),
  'POST /api/v1/guest-auth/password-reset/confirm': (request) =>
    request.bodyText.includes('"token":"expired"')
      ? {
          status: 400,
          body: errorBody('E_AUTH_RESET_TOKEN_INVALID', 'Token hết hiệu lực', request.url, 't400'),
        }
      : { status: 204 },
};

function defaultHandler(request: RecordedRequest): FixtureOutcome {
  const route = ROUTES[`${request.method} ${request.url}`];
  return route === undefined ? { status: 200, body: { status: 'ok' } } : route(request);
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
      const outcome = handler(recorded);
      requests.push(recorded);
      response.writeHead(outcome.status, { 'content-type': 'application/json' });
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

function makeClient(): ApiClient {
  return new ApiClient({ baseUrl, fetchImpl: fetch, sleep: async () => undefined, maxAttempts: 3 });
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

const newUser: CreateUserRequest = {
  username: 'quanly02',
  fullName: 'Quản lý 02',
  role: 'MANAGER',
  propertyScope: ['p1'],
  temporaryPassword: 'matkhau123',
};

describe('hợp đồng F1 qua HTTP thật', () => {
  it('danh sách người dùng đi đúng tuyến, bộ lọc và không mang Idempotency-Key', async () => {
    const page = await createUsersApi(makeClient()).list({ limit: 20, role: 'MANAGER' });
    expect(page.data.meta.total).toBe(1);
    expect(page.data.data[0]?.role).toBe('FRONT_DESK');
    const seen = recorded(0);
    expect(`${seen.method} ${seen.url}`).toBe('GET /api/v1/users?limit=20&role=MANAGER');
    expect(seen.headers['idempotency-key']).toBeUndefined();
  });

  it('tạo người dùng trả 201 với userSummary đã chuẩn hoá, trùng tên trả 409', async () => {
    const users = createUsersApi(makeClient());
    const created = await users.create(newUser);
    expect(created.status).toBe(201);
    expect(created.data.version).toBe(3);
    expect(recorded(0).bodyText).toContain('"temporaryPassword":"matkhau123"');
    const error = await catchApiError(users.create({ ...newUser, username: 'letan01' }));
    expect(error.status).toBe(409);
    expect(error.knownCode).toBe('E_AUTH_USERNAME_TAKEN');
  });

  it('POST /users và DELETE …/pin không tự gửi lại khi máy chủ bận (QĐ-03 T9)', async () => {
    handler = (request) => ({
      status: 503,
      body: errorBody('E_GEN_SERVICE_UNAVAILABLE', 'Bận', request.url, 't503'),
    });
    const users = createUsersApi(makeClient());
    await catchApiError(users.create(newUser));
    expect(requests).toHaveLength(1);
    requests.length = 0;
    await catchApiError(users.deletePin('u1'));
    expect(requests).toHaveLength(1);
    expect(`${recorded(0).method} ${recorded(0).url}`).toBe('DELETE /api/v1/users/u1/pin');
  });

  it('đổi mật khẩu và đặt PIN gửi đúng thân chuẩn hoá', async () => {
    const api = createAuthApi(makeClient());
    await api.changePassword({ currentPassword: 'matkhau123', newPassword: 'matkhaumoi123' });
    expect(recorded(0).url).toBe('/api/v1/auth/password');
    expect(recorded(0).bodyText).toBe(
      '{"currentPassword":"matkhau123","newPassword":"matkhaumoi123"}',
    );
    await api.setPin({ pin: '123456', currentPassword: 'matkhaumoi123' });
    expect(`${recorded(1).method} ${recorded(1).url}`).toBe('PUT /api/v1/auth/pin');
    expect(recorded(1).bodyText).toBe('{"pin":"123456","currentPassword":"matkhaumoi123"}');
  });

  it('yêu cầu đặt lại mật khẩu luôn trả 202, xác nhận token hợp lệ trả 204', async () => {
    const api = createAuthApi(makeClient());
    const requested = await api.passwordResetRequest({ phone: '+84901234567' });
    expect(requested.status).toBe(202);
    expect(recorded(0).url).toBe('/api/v1/guest-auth/password-reset/request');
    const confirmed = await api.passwordResetConfirm({
      token: 'tok-1',
      newPassword: 'matkhaumoi123',
    });
    expect(confirmed.status).toBe(204);
    expect(recorded(1).bodyText).toBe('{"token":"tok-1","newPassword":"matkhaumoi123"}');
  });

  it('token đặt lại không hợp lệ trả 400 E_AUTH_RESET_TOKEN_INVALID', async () => {
    const error = await catchApiError(
      createAuthApi(makeClient()).passwordResetConfirm({
        token: 'expired',
        newPassword: 'matkhaumoi123',
      }),
    );
    expect(error.status).toBe(400);
    expect(error.knownCode).toBe('E_AUTH_RESET_TOKEN_INVALID');
  });
});
