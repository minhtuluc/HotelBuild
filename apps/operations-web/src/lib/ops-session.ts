'use client';

/**
 * Nhà máy **duy nhất** dựng client có phiên nhân viên cho operations web (HB-201).
 *
 * Mọi màn `app/(ops)/**` gọi API qua BFF `/api/session/sys/**`: bearer nằm trong bộ nhớ của
 * `createSessionClient` (không cookie/localStorage), refresh bằng cookie `HttpOnly` của BFF, và đây là
 * chỗ duy nhất biết ghép hai thứ đó lại (mẫu: `app/(ops)/audit-logs/api.ts`). `module` là các tiền tố
 * tuyến BFF mà màn hình sở hữu: nhà máy **chặn** mọi request ra ngoài phạm vi đó — kể cả gọi thẳng
 * `/api/v1` — nên không màn nào lặng lẽ bỏ qua phiên (HB-201 AC3).
 *
 * **Chưa có phiên ⇒ không request nào rời trình duyệt**: bearer rỗng thì nhà máy trả ngay một 401 theo
 * đúng bao lỗi §4.1 (giống hệt câu BFF trả khi thiếu bearer) nên màn hình rơi vào nhánh 401 hiện có
 * (`lib/screen-state.ts` → `forbidden`) và `onExpired` gọi đúng một lần — không hiện "danh sách rỗng"
 * hay lỗi mạng như thể máy chủ trả lời.
 */
import { useEffect, useRef } from 'react';
import { ApiClient, ApiError } from '@pinehill/api-client';
import { createSessionClient } from '@pinehill/web-session/client';

/**
 * Phần phiên nhân viên mà nhà máy này dùng. `@pinehill/web-session` chưa xuất tên kiểu cho client phiên,
 * nên khai báo tường minh ở đây: hợp đồng chỉ gồm ba thao tác, không phụ thuộc hình dạng nội bộ.
 */
interface SessionHandle {
  getAccessToken: () => Promise<string | null>;
  refresh: (rejectedToken?: string) => Promise<string | null>;
  dispose: () => void;
}

/** Tiền tố tuyến BFF mà màn hình sở hữu (khớp `app/api/session/sys/<module>/**`), ví dụ `/bookings`. */
export type OpsModule = `/${string}`;

export interface OpsSessionOptions {
  /** Gọi một lần khi phiên hết hiệu lực (refresh thất bại) — màn hình chuyển trạng thái từ chối. */
  onExpired?: () => void;
  /** PIN đang giữ trong bộ nhớ cho lệnh tài chính; chỉ màn cần mới truyền. */
  getPinToken?: () => string | null;
}

export interface OpsSession {
  /** Client trỏ vào BFF `/api/session/sys`: tự gắn bearer và tự refresh đúng một lần khi 401. */
  readonly client: ApiClient;
  /** Mở lại phiên sau `dispose` (StrictMode gọi effect hai lần khi phát triển). */
  readonly start: () => void;
  /** Dừng phiên (ngừng refresh) khi màn hình unmount. */
  readonly dispose: () => void;
}

/** Gốc BFF của phiên nhân viên — trùng thư mục `app/api/session/sys/**` của app này. */
export const OPS_BFF_ROOT = '/api/session/sys';

/** 401 theo đúng bao lỗi §4.1 mà BFF trả khi thiếu bearer (`access()` trong `journey.ts`). */
function missingSession(pathname: string): Response {
  return Response.json(
    {
      code: 'E_AUTH_INVALID_CREDENTIALS',
      message: 'Không thể hoàn tất yêu cầu.',
      traceId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      path: pathname,
    },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * Đường dẫn của request đã ghép. `origin` rỗng khi render trên server (không có `window`): lúc đó URL
 * còn tương đối nên lấy thẳng phần path — không cần thêm host giả để phân tích.
 */
function pathnameOf(url: string, origin: string): string {
  if (origin === '') return url.split('?')[0]!;
  return new URL(url, origin).pathname;
}

/**
 * Chặn request rời khỏi phạm vi BFF của màn hình, và cắt luôn khi chưa có bearer: `ApiClient` ghép URL
 * tuyệt đối nên chỉ cần so `pathname` với `/api/session/sys<module>`.
 */
function opsFetch(modules: readonly string[], origin: string): typeof fetch {
  const inside = (pathname: string): boolean =>
    modules.some(
      (module) =>
        pathname === OPS_BFF_ROOT + module || pathname.startsWith(`${OPS_BFF_ROOT}${module}/`),
    );
  return (input, init) => {
    const pathname = pathnameOf(String(input), origin);
    if (!inside(pathname))
      throw new ApiError({ kind: 'protocol', message: `Tuyến ngoài phạm vi phiên: ${pathname}` });
    const headers = new Headers(init?.headers);
    if (!headers.has('authorization')) return Promise.resolve(missingSession(pathname));
    headers.set('x-session-request', '1');
    return fetch(input, { ...init, headers });
  };
}

/**
 * Dựng client phiên cho một màn hình. Trả về ngay (không I/O): phiên chỉ được tạo khi có request đầu
 * tiên, nên dựng trong lúc render cũng không chạm mạng.
 *
 * Hàm này chạy cả khi Next **render trên server** (client component được SSR): không có `window` thì
 * `baseUrl` để tương đối `/api/session/sys` — chỉ là chuỗi, không truy cập mạng; lượt render ở trình
 * duyệt dựng lại client với origin thật.
 */
export function opsSessionClient(
  module: OpsModule | readonly OpsModule[],
  options: OpsSessionOptions = {},
): OpsSession {
  const modules = typeof module === 'string' ? [module] : module;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  let session: SessionHandle | undefined;
  let active = true;
  const getSession = () =>
    (session ??= createSessionClient({
      kind: 'staff',
      ...(options.onExpired === undefined ? {} : { onExpired: options.onExpired }),
    }));
  const token = async () => {
    if (!active) return null;
    return await getSession().getAccessToken();
  };
  const client = new ApiClient({
    baseUrl: origin + OPS_BFF_ROOT,
    getAccessToken: token,
    ...(options.getPinToken === undefined ? {} : { getPinToken: options.getPinToken }),
    onUnauthorized: async (rejected) => active && (await getSession().refresh(rejected)) !== null,
    maxAttempts: 2,
    fetchImpl: opsFetch(modules, origin),
  });
  return {
    client,
    start: () => {
      active = true;
    },
    dispose: () => {
      active = false;
      session?.dispose();
      session = undefined;
    },
  };
}

/**
 * Phiên của một màn hình, sống theo vòng đời component: `start` khi mount (StrictMode chạy effect hai
 * lần ở môi trường phát triển), `dispose` khi unmount. `options` được đọc qua ref nên callback của màn
 * hình luôn mới nhất mà client vẫn giữ nguyên danh tính (không dựng lại `ApiClient` mỗi lần render).
 */
export function useOpsSession(
  module: OpsModule | readonly OpsModule[],
  options: OpsSessionOptions = {},
): OpsSession {
  const latest = useRef(options);
  latest.current = options;
  const created = useRef<OpsSession | null>(null);
  if (created.current === null)
    created.current = opsSessionClient(module, {
      onExpired: () => latest.current.onExpired?.(),
      getPinToken: () => latest.current.getPinToken?.() ?? null,
    });
  const session = created.current;
  useEffect(() => {
    session.start();
    return () => session.dispose();
  }, [session]);
  return session;
}
