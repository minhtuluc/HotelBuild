import { vi } from 'vitest';
import { opsSessionClient, type OpsSession } from '../src/lib/ops-session';

/**
 * Khung kiểm thử cho HB-201: dựng môi trường trình duyệt tối thiểu (Web Locks, localStorage, fetch)
 * để `createSessionClient` thật chạy được trong môi trường node, và ghi lại URL đã fetch.
 */
export interface OpsBrowser {
  /** URL của mọi fetch đã phát ra, theo thứ tự. */
  readonly calls: string[];
  /** Mở phiên cho một màn; `reset()` sẽ dispose hết. */
  open(module: Parameters<typeof opsSessionClient>[0], onExpired?: () => void): OpsSession;
  reset(): void;
}

const storage = new Map<string, string>();

export function installOpsBrowser(fetchImpl: typeof fetch): OpsBrowser {
  const calls: string[] = [];
  const sessions: OpsSession[] = [];
  vi.stubGlobal('window', { location: { origin: 'http://ops.test' } });
  vi.stubGlobal('navigator', {
    locks: { request: (_name: string, task: () => Promise<unknown>) => task() },
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  });
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return fetchImpl(input, init);
  });
  return {
    calls,
    open: (module, onExpired) => {
      const session = opsSessionClient(module, onExpired === undefined ? {} : { onExpired });
      sessions.push(session);
      return session;
    },
    reset: () => {
      sessions.forEach((session) => session.dispose());
      sessions.length = 0;
      storage.clear();
      vi.unstubAllGlobals();
    },
  };
}

/** Phiên thật vừa cấp (BFF trả token) — dùng cho nhánh "có phiên". */
export const issuedSession = (): Response =>
  Response.json({
    accessToken: 'synthetic-access-ops',
    refreshToken: 'synthetic-refresh-ops',
    tokenType: 'Bearer',
    expiresInSeconds: 900,
    refreshExpiresInSeconds: 604800,
    mustChangePassword: false,
  });

/** BFF từ chối refresh (trình duyệt chưa có cookie phiên). */
export const refusedSession = (): Response =>
  Response.json(
    {
      code: 'E_AUTH_INVALID_CREDENTIALS',
      message: 'Synthetic denial',
      traceId: 'synthetic-trace',
      path: '/api/session/refresh',
    },
    { status: 401 },
  );

/** Trang danh sách rỗng hợp lệ theo `listResponseSchema`. */
export const emptyList = (): Response =>
  Response.json({ data: [], meta: { limit: 20, nextCursor: null, hasMore: false, total: 0 } });
