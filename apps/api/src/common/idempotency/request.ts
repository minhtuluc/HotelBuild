import { createHash } from 'node:crypto';
import { AppError } from '../app-error.js';

export interface Principal {
  readonly type: 'USER' | 'GUEST' | 'SYSTEM' | 'ANONYMOUS';
  readonly id: string;
}
export interface RequestIdentity {
  readonly principal: Principal;
  readonly method: string;
  readonly path: string;
  readonly key: string;
  readonly requestHash: string;
}
export interface CommandRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: unknown;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const invalidCommand = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu chống trùng không hợp lệ.');
function scalarJson(value: unknown): string | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidCommand();
    return JSON.stringify(value);
  }
  return undefined;
}

/** Stable JSON spelling; neither object insertion order nor prototype keys affect the hash. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw invalidCommand();
  const scalar = scalarJson(value);
  if (scalar !== undefined) return scalar;
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v, depth + 1)).join(',')}]`;
  if (typeof value !== 'object' || value === null) throw invalidCommand();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidCommand();
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key), depth + 1)}`)
    .join(',')}}`;
}
function normalizedPath(url: URL): string {
  try {
    return (
      url.pathname
        .replace(/\/+$/, '')
        .split('/')
        .map((part) => {
          const decoded = decodeURIComponent(part);
          const resource = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(decoded)
            ? decoded.toLowerCase()
            : decoded;
          return encodeURIComponent(resource);
        })
        .join('/') || '/'
    );
  } catch {
    throw invalidCommand();
  }
}
function commandUrl(raw: string): URL {
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\#\u0000-\u0020]/.test(raw))
    throw invalidCommand();
  try {
    for (const segment of raw.split('?')[0]!.split('/')) {
      const decoded = decodeURIComponent(segment);
      if (decoded === '.' || decoded === '..') throw invalidCommand();
    }
    return new URL(raw, 'http://idempotency.local');
  } catch {
    throw invalidCommand();
  }
}
function commandHeaders(request: CommandRequest): { key: string; ifMatch: string | null } {
  const key = request.headers['idempotency-key'];
  const ifMatch = request.headers['if-match'] ?? null;
  if (typeof key !== 'string' || !UUID.test(key)) throw invalidCommand();
  if (ifMatch !== null && typeof ifMatch !== 'string') throw invalidCommand();
  return { key: key.toLowerCase(), ifMatch };
}
export function identifyRequest(principal: Principal, request: CommandRequest): RequestIdentity {
  const { key, ifMatch } = commandHeaders(request);
  if (!['USER', 'GUEST', 'SYSTEM', 'ANONYMOUS'].includes(principal.type) || !principal.id)
    throw invalidCommand();
  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw invalidCommand();
  const url = commandUrl(request.url);
  const path = normalizedPath(url);
  const query = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const requestHash = createHash('sha256')
    .update(
      canonicalJson({
        body: request.body === undefined ? null : request.body,
        bodyPresent: request.body !== undefined,
        ifMatch,
        method,
        path,
        query,
      }),
    )
    .digest('hex');
  return Object.freeze({
    principal: Object.freeze({ ...principal }),
    method,
    path,
    key,
    requestHash,
  });
}
