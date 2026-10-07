import 'server-only';
import { ApiClient, ApiError } from '@pinehill/api-client';
import {
  guestLoginRequestSchema,
  loginRequestSchema,
  tokenPairSchema,
  type TokenPair,
} from '@pinehill/contracts';
import { readRefreshCookie, sessionCookie, type SessionKind } from './cookies.js';
import type { PublicSession } from './protocol.js';
export type SessionAction = 'login' | 'refresh' | 'logout';
export interface SessionOptions {
  kind: SessionKind;
  baseUrl: string;
  development?: boolean;
  origin?: string;
}

class InvalidInput extends Error {}
async function loginBody(request: Request): Promise<unknown> {
  if (!request.body) throw new InvalidInput();
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) throw new InvalidInput();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value;
  } catch {
    throw new InvalidInput();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
function credentials(kind: SessionKind, value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidInput();
  const input = { ...value, clientSurface: kind === 'staff' ? 'OPS_WEB' : 'GUEST_WEB' };
  const parsed =
    kind === 'staff'
      ? loginRequestSchema.safeParse(input)
      : guestLoginRequestSchema.safeParse(input);
  if (!parsed.success) throw new InvalidInput();
  return parsed.data;
}
function publicSession(pair: TokenPair): PublicSession {
  return {
    accessToken: pair.accessToken,
    expiresInSeconds: pair.expiresInSeconds,
    mustChangePassword: pair.mustChangePassword ?? false,
  };
}
function failure(request: Request, error: unknown): Response {
  const api = error instanceof ApiError ? error : undefined;
  const status = error instanceof InvalidInput ? 400 : errorStatus(api);
  const code =
    error instanceof InvalidInput
      ? 'E_GEN_VALIDATION_FAILED'
      : (api?.knownCode ?? 'E_GEN_SERVICE_UNAVAILABLE');
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (api?.retryAfterSeconds !== undefined) headers['retry-after'] = String(api.retryAfterSeconds);
  return Response.json(
    {
      code,
      message: 'Không thể hoàn tất yêu cầu phiên.',
      traceId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      path: new URL(request.url).pathname,
    },
    { status, headers },
  );
}
function errorStatus(error: ApiError | undefined): number {
  return error?.status && error.status >= 400 ? error.status : 502;
}
function csrf(request: Request, options: SessionOptions): boolean {
  return (
    request.method === 'POST' &&
    request.headers.get('origin') === (options.origin ?? new URL(request.url).origin) &&
    request.headers.get('x-session-request') === '1'
  );
}
async function execute(
  request: Request,
  action: SessionAction,
  options: SessionOptions,
): Promise<Response> {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  const client = new ApiClient({
    baseUrl: options.baseUrl,
    maxAttempts: 1,
    getAccessToken: () => token,
  });
  if (action === 'logout') {
    if (!token)
      throw new ApiError({
        kind: 'http',
        status: 401,
        code: 'E_AUTH_INVALID_CREDENTIALS',
        message: 'No access token',
      });
    await client.requestVoid({ method: 'POST', path: '/auth/logout' });
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }
  const prefix = options.kind === 'staff' ? '/auth' : '/guest-auth';
  let body: unknown;
  if (action === 'login') body = credentials(options.kind, await loginBody(request));
  else {
    const refreshToken = readRefreshCookie(options.kind, request.headers.get('cookie'));
    if (!refreshToken)
      throw new ApiError({
        kind: 'http',
        status: 401,
        code: 'E_AUTH_INVALID_CREDENTIALS',
        message: 'No refresh cookie',
      });
    body = { refreshToken };
  }
  const result = await client.request({
    method: 'POST',
    path: `${prefix}/${action}`,
    body,
    decoder: tokenPairSchema,
  });
  return Response.json(publicSession(result.data), {
    headers: {
      'cache-control': 'no-store',
      'set-cookie': sessionCookie(
        options.kind,
        result.data.refreshToken,
        result.data.refreshExpiresInSeconds,
        options.origin ?? request.url,
        options.development,
      ),
    },
  });
}
export function createSessionHandler(options: SessionOptions) {
  return async (request: Request, action: SessionAction): Promise<Response> => {
    if (!csrf(request, options))
      return failure(
        request,
        new ApiError({ kind: 'http', status: 403, code: 'E_RBAC_FORBIDDEN', message: 'CSRF' }),
      );
    let response: Response;
    try {
      response = await execute(request, action, options);
    } catch (error) {
      response = failure(request, error);
    }
    if (action === 'logout' || (action === 'refresh' && !response.ok))
      response.headers.set(
        'set-cookie',
        sessionCookie(options.kind, '', 0, options.origin ?? request.url, options.development),
      );
    return response;
  };
}

export { createJourneyHandler, type JourneyOptions } from './journey.js';
