/**
 * Dựng `ApiClient` cho app (F0-06, F0-08).
 * React Native không có `crypto.randomUUID` mặc định nên truyền `createId` từ expo-crypto
 * để `Idempotency-Key`/mã tương quan luôn là UUIDv4 từ nguồn ngẫu nhiên an toàn.
 */
import { ApiClient } from '@pinehill/api-client';
import { randomUUID } from 'expo-crypto';
import { mobileEnv } from './config/index';

export interface AppApiOptions {
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
}

export function createAppApiClient(options: AppApiOptions = {}) {
  const env = mobileEnv();
  return new ApiClient({
    baseUrl: env.EXPO_PUBLIC_API_BASE_URL,
    createId: () => randomUUID(),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
  });
}
