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
