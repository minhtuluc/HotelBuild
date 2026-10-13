import 'server-only';
import { onlinePaymentCreateRequestSchema } from '@pinehill/contracts';
import { ApiClient, ApiError, type RequestBase } from '@pinehill/api-client';
import {
  JourneyInputError,
  journeyRoute,
  parseInput,
  type JourneyRoute,
} from './journey-routes.js';
export interface JourneyOptions {
  baseUrl: string;
  origin?: string;
  /** Opt-in public field identifiers; never forward upstream prose or arbitrary details. */
  validationFields?: readonly string[];
  /** Trusted opt-in for documented noncommitting409 validation codes; field whitelist still required. */
  validationErrorCodes?: readonly string[];
  /** Trusted server composition only; a supplied resolver replaces the guest catalogue entirely. */
  routeResolver?: (request: Request) => JourneyRoute | undefined;
}
function fail(status: number, code: string): never {
  throw new ApiError({ kind: 'http', status, code, message: 'Journey request rejected' });
}
function access(request: Request, required: boolean): string | null {
  const value = request.headers.get('authorization');
  const token = value && /^Bearer [^\s]+$/.test(value) ? value.slice(7) : null;
  if (required && !token) fail(401, 'E_AUTH_INVALID_CREDENTIALS');
  return token;
}
function bodyBudget(route: JourneyRoute, options: JourneyOptions): number {
  const limit = route.maxBodyBytes ?? 16384;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1048576) throw new JourneyInputError();
  if (limit > 16384 && (!options.routeResolver || !route.protected)) throw new JourneyInputError();
  return limit;
}
async function readBody(request: Request, budget: number): Promise<unknown> {
  if (!request.body) throw new JourneyInputError();
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > budget) throw new JourneyInputError();
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
    throw new JourneyInputError();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
function query(request: Request, route: JourneyRoute) {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new JourneyInputError();
  const input = Object.fromEntries(entries);
  if (route.query) return parseInput({ parse: route.query }, input);
  if (entries.length) throw new JourneyInputError();
  return undefined;
}
function writeKey(request: Request): string | undefined {
  if (request.method === 'GET') return undefined;
  const value = request.headers.get('idempotency-key');
  if (
    !value ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  )
    throw new JourneyInputError();
  return value;
}
function csrf(request: Request, options: JourneyOptions) {
  if (request.method === 'GET') return;
  if (
    request.headers.get('origin') !== (options.origin ?? new URL(request.url).origin) ||
    request.headers.get('x-session-request') !== '1'
  )
    fail(403, 'E_RBAC_FORBIDDEN');
}
function upstreamStatus(api: ApiError | undefined): number {
  const status = api?.status;
  return status !== undefined && status >= 400 && status <= 599 ? status : 502;
}
function additionalValidation(api: ApiError | undefined, options: JourneyOptions): boolean {
  if (api?.status !== 409) return false;
  return options.validationErrorCodes?.includes(api.knownCode ?? '') ?? false;
}
function publicDetails(api: ApiError | undefined, options: JourneyOptions) {
  const extra = additionalValidation(api, options);
  if (!extra && ![400, 422].includes(api?.status ?? 0)) return {};
  const details = api?.details
    ?.filter(
      (item) =>
        options.validationFields?.includes(item.field) && /^[A-Z][A-Z0-9_]{0,63}$/.test(item.issue),
    )
    .slice(0, extra ? 31 : 30);
  return details?.length ? { details } : {};
}
function failure(request: Request, error: unknown, options: JourneyOptions): Response {
  const api = error instanceof ApiError ? error : undefined;
  const invalid = error instanceof JourneyInputError;
  const status = invalid ? 400 : upstreamStatus(api);
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (api?.retryAfterSeconds !== undefined) headers['retry-after'] = String(api.retryAfterSeconds);
  return Response.json(
    {
      code: invalid ? 'E_GEN_VALIDATION_FAILED' : (api?.knownCode ?? 'E_GEN_SERVICE_UNAVAILABLE'),
      message: 'Không thể hoàn tất yêu cầu đặt phòng.',
      traceId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      path: new URL(request.url).pathname,
      ...publicDetails(api, options),
      ...(api?.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: api.retryAfterSeconds }),
    },
    { status, headers },
  );
}
function validatePaymentReturn(
  request: Request,
  route: JourneyRoute,
  body: unknown,
  options: JourneyOptions,
) {
  if (route.path === '/payments/online') {
    const input = parseInput(onlinePaymentCreateRequestSchema, body);
    const origin = options.origin ?? new URL(request.url).origin;
    if (input.returnUrl !== `${origin}/booking/${encodeURIComponent(input.bookingId)}/pay`)
      throw new JourneyInputError();
  }
}
async function execute(request: Request, options: JourneyOptions): Promise<Response> {
  const route = options.routeResolver ? options.routeResolver(request) : journeyRoute(request);
  if (!route) fail(404, 'E_GEN_NOT_FOUND');
  csrf(request, options);
  const token = access(request, route.protected);
  const idempotencyKey = writeKey(request);
  const parsedQuery = query(request, route);
  const body = route.body
    ? parseInput(route.body, await readBody(request, bodyBudget(route, options)))
    : undefined;
  validatePaymentReturn(request, route, body, options);
  const ifMatch = request.headers.get('if-match');
  const spec: RequestBase = {
    method: route.method,
    ...(ifMatch === null ? {} : { ifMatch }),
    path: route.path,
    signal: request.signal,
    ...(parsedQuery === undefined ? {} : { query: parsedQuery }),
    ...(body === undefined ? {} : { body }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
  const client = new ApiClient({
    baseUrl: options.baseUrl,
    getAccessToken: () => token,
    maxAttempts: 1,
    fetchImpl: (input, init) => fetch(input, { ...init, redirect: 'error' }),
  });
  const result = route.decoder
    ? await client.request({ ...spec, decoder: route.decoder })
    : await client.requestVoid(spec);
  return success(result, Boolean(route.decoder));
}

function success(
  result: import('@pinehill/api-client').ApiResponse<unknown>,
  decoded: boolean,
): Response {
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (result.replayed) headers['idempotency-replayed'] = 'true';
  if (result.etag !== undefined) headers.etag = result.etag;
  if (!decoded) return new Response(null, { status: result.status, headers });
  return Response.json(result.data, { status: result.status, headers });
}
export function createJourneyHandler(options: JourneyOptions) {
  return async (request: Request): Promise<Response> => {
    try {
      return await execute(request, options);
    } catch (error) {
      return failure(request, error, options);
    }
  };
}
