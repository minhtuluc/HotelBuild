import type { ApiResponse } from './client.js';
import type { ApiError } from './errors.js';

export interface FetchedResponse {
  kind: 'ok';
  status: number;
  headers: Headers;
  payload: unknown;
  rejectedAccessToken: string | undefined;
}

export type AttemptOutcome<T> =
  | { kind: 'ok'; status: number; value: Omit<ApiResponse<T>, 'status'> }
  | {
      kind: 'error';
      error: ApiError;
      retryAfterMs?: number | undefined;
      rejectedAccessToken?: string | undefined;
    };

export function sentAccessToken(authorization: string | undefined): string | undefined {
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
}

export function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end -= 1;
  return end === url.length ? url : url.slice(0, end);
}

export function defaultSleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Nguồn ngẫu nhiên tối thiểu cần có (có ở web và ở Node; RN truyền qua `createId`). */
interface RandomSource {
  getRandomValues(array: Uint8Array): Uint8Array;
}

/** UUIDv4 từ nguồn ngẫu nhiên mật mã; đặt đúng bit version/variant theo RFC 4122. */
function uuidV4FromRandomValues(cryptoApi: RandomSource): string {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Nguồn ID mặc định cho `Idempotency-Key`/mã tương quan.
 * Không có nguồn an toàn thì **dừng ngay** thay vì sinh ID yếu bằng `Math.random`
 * (hợp đồng yêu cầu UUIDv4 — api.md §1.3); React Native truyền `createId` từ expo-crypto.
 */
export function requireSecureIdFactory(): () => string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return () => cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function')
    return () => uuidV4FromRandomValues(cryptoApi);
  throw new Error(
    'Không có nguồn ngẫu nhiên an toàn để sinh UUIDv4; truyền `createId` (ví dụ expo-crypto randomUUID) khi tạo ApiClient.',
  );
}
