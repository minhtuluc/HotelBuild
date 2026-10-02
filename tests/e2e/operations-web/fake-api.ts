/** Phụ trợ dựng phản hồi cho API giả của F2 (HB-033 chưa có backend). */
import type { Route } from '@playwright/test';

export function listBody(rows: readonly unknown[]): string {
  return JSON.stringify({
    data: rows,
    meta: { limit: 20, nextCursor: null, hasMore: false, total: rows.length },
  });
}

export function errorBody(code: string, traceId: string, path: string): string {
  return JSON.stringify({
    code,
    message: 'Lỗi từ API giả',
    traceId,
    timestamp: '2026-10-02T00:00:00.000Z',
    path,
  });
}

export async function fulfillJson(
  route: Route,
  status: number,
  body: string,
): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body });
}
