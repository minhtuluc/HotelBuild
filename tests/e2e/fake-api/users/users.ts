/**
 * API giả F1 — người dùng nội bộ SCR-15 (HB-021). Server HB-016 chưa có nên màn hình được kiểm trên hợp
 * đồng đã phát hành (`GET/POST /users`, `PUT /users/{id}/access` + If-Match, `DELETE /users/{id}/pin`).
 *
 * Dùng `page.route` giống F7/F8: server HTTP dùng chung không biết plugin này. Chỉ import **kiểu** từ
 * Playwright vì `server.ts` nạp mọi tệp trong thư mục này lúc khởi động.
 */
import type { Page, Route } from '@playwright/test';

type Role =
  | 'OWNER'
  | 'MANAGER'
  | 'FRONT_DESK'
  | 'RESERVATION_AGENT'
  | 'ACCOUNTANT'
  | 'HOUSEKEEPING'
  | 'SYSADMIN';

export interface FakeUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  propertyScope: string[];
  isActive: boolean;
  lockedUntil: string | null;
  hasPin: boolean;
  version: number;
}

export interface UsersApiOptions {
  /** Vai trò của người đang đăng nhập (`GET /auth/me`). Mặc định OWNER. */
  actorRole?: Role;
  /** Ép `GET /users` trả lỗi (ví dụ 403 cho vai trò không được xem). */
  listStatus?: number;
  /** Ép `GET /properties` trả lỗi (SYSADMIN không đọc được cơ sở) để kiểm nhập mã cơ sở tay. */
  propertiesStatus?: number;
  /** Trả danh sách rỗng. */
  empty?: boolean;
  /** Số dòng mỗi trang (kiểm con trỏ). Mặc định 20. */
  pageSize?: number;
  /** Lần `PUT access` đầu tiên bị 412 vì có người khác vừa sửa (phiên bản tăng, vai trò đổi). */
  staleFirstSave?: boolean;
  /** Mã người dùng mà máy chủ luôn từ chối sửa (403 `E_RBAC_FORBIDDEN`), như tài khoản OWNER với SYSADMIN. */
  forbidAccessFor?: readonly string[];
  /** Phản hồi `POST /users` đầu tiên bị mất (mạng đứt sau khi máy chủ đã nhận). */
  dropFirstCreate?: boolean;
}

export interface UsersApiSpy {
  readonly listUrls: string[];
  readonly creates: Array<{ key: string | undefined; body: Record<string, unknown> }>;
  readonly accessPuts: Array<{ url: string; ifMatch: string | undefined; body: Record<string, unknown> }>;
  readonly pinDeletes: string[];
  readonly users: FakeUser[];
}

const ME_ID = 'u-me';

function seed(): FakeUser[] {
  return [
    { id: 'u-owner', username: 'chu.so.huu', fullName: 'Chủ sở hữu', role: 'OWNER', propertyScope: [], isActive: true, lockedUntil: null, hasPin: true, version: 1 },
    { id: 'u1', username: 'le.tan', fullName: 'Lê Tân', role: 'FRONT_DESK', propertyScope: ['p1'], isActive: true, lockedUntil: null, hasPin: true, version: 4 },
    { id: 'u2', username: 'quan.ly', fullName: 'Quản Lý', role: 'MANAGER', propertyScope: ['p1', 'p2'], isActive: true, lockedUntil: '2099-01-01T00:00:00.000Z', hasPin: false, version: 2 },
    { id: 'u3', username: 'buong.phong', fullName: 'Buồng Phòng', role: 'HOUSEKEEPING', propertyScope: ['p2'], isActive: false, lockedUntil: null, hasPin: true, version: 7 },
  ];
}

const PROPERTIES = [
  { id: 'p1', name: 'Đà Lạt', status: 'ACTIVE', activeRoomCount: 20, overbookLimitPct: 5, checkInTime: '14:00', checkOutTime: '12:00', version: 1 },
  { id: 'p2', name: 'Nha Trang', status: 'ACTIVE', activeRoomCount: 12, overbookLimitPct: 5, checkInTime: '14:00', checkOutTime: '12:00', version: 1 },
];

function errorBody(code: string, message: string, path: string): string {
  return JSON.stringify({ code, message, traceId: 'trace-users-synthetic', timestamp: '2026-10-22T03:00:00.000Z', path });
}

async function json(route: Route, status: number, body: string, headers: Record<string, string> = {}): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body, headers });
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};
}

function filtered(users: readonly FakeUser[], params: URLSearchParams): FakeUser[] {
  const role = params.get('role');
  const property = params.get('propertyId');
  const q = (params.get('q') ?? '').toLowerCase();
  return users.filter(
    (user) =>
      (role === null || user.role === role) &&
      (property === null || user.propertyScope.includes(property)) &&
      (q === '' || user.username.includes(q) || user.fullName.toLowerCase().includes(q)),
  );
}

export async function installUsersApi(page: Page, options: UsersApiOptions = {}): Promise<UsersApiSpy> {
  const users = seed();
  const spy: UsersApiSpy = { listUrls: [], creates: [], accessPuts: [], pinDeletes: [], users };
  const actorRole = options.actorRole ?? 'OWNER';
  let staleServed = false;
  let createDropped = false;
  const replay = new Map<string, FakeUser>();
  users.unshift({ id: ME_ID, username: 'toi.dang.nhap', fullName: 'Tôi đăng nhập', role: actorRole, propertyScope: ['p1'], isActive: true, lockedUntil: null, hasPin: true, version: 3 });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();
    if (method === 'GET' && path === '/auth/me') {
      await json(route, 200, JSON.stringify({ userId: ME_ID, username: 'toi.dang.nhap', fullName: 'Tôi đăng nhập', role: actorRole, propertyScope: ['p1'], hasPin: true, mustChangePassword: false }));
      return;
    }
    if (method === 'GET' && path === '/properties') {
      if (options.propertiesStatus !== undefined) {
        await json(route, options.propertiesStatus, errorBody('E_RBAC_FORBIDDEN', 'Không đọc được cơ sở', path));
        return;
      }
      await json(route, 200, JSON.stringify({ data: PROPERTIES, meta: { limit: 20, nextCursor: null, hasMore: false, total: PROPERTIES.length } }));
      return;
    }
    if (method === 'GET' && path === '/users') {
      spy.listUrls.push(request.url());
      if (options.listStatus !== undefined) {
        await json(route, options.listStatus, errorBody('E_RBAC_FORBIDDEN', 'Không có quyền xem người dùng', path));
        return;
      }
      const rows = options.empty === true ? [] : filtered(users, url.searchParams);
      const size = options.pageSize ?? 20;
      const start = Number(url.searchParams.get('cursor') ?? '0');
      const slice = rows.slice(start, start + size);
      const more = start + size < rows.length;
      await json(route, 200, JSON.stringify({ data: slice, meta: { limit: size, nextCursor: more ? String(start + size) : null, hasMore: more, total: rows.length } }));
      return;
    }
    if (method === 'POST' && path === '/users') {
      const body = object(request.postDataJSON());
      const key = request.headers()['idempotency-key'];
      spy.creates.push({ key, body });
      const replayed = key === undefined ? undefined : replay.get(key);
      if (replayed !== undefined) {
        await json(route, 201, JSON.stringify(replayed), { 'idempotency-replayed': 'true' });
        return;
      }
      if (body.username === 'le.tan') {
        await json(route, 409, errorBody('E_AUTH_USERNAME_TAKEN', 'Tên đăng nhập đã được dùng.', path));
        return;
      }
      const created: FakeUser = {
        id: `u-new-${users.length}`,
        username: String(body.username),
        fullName: String(body.fullName),
        role: body.role as Role,
        propertyScope: Array.isArray(body.propertyScope) ? body.propertyScope.map(String) : [],
        isActive: true,
        lockedUntil: null,
        hasPin: false,
        version: 0,
      };
      users.push(created);
      if (key !== undefined) replay.set(key, created);
      if (options.dropFirstCreate === true && !createDropped) {
        createDropped = true;
        await route.abort('connectionreset');
        return;
      }
      await json(route, 201, JSON.stringify(created), { etag: '"0"' });
      return;
    }
    const access = /^\/users\/([^/]+)\/access$/.exec(path);
    if (method === 'PUT' && access !== null) {
      const id = decodeURIComponent(access[1] ?? '');
      const target = users.find((user) => user.id === id);
      const body = object(request.postDataJSON());
      const ifMatch = request.headers()['if-match'];
      spy.accessPuts.push({ url: request.url(), ifMatch, body });
      if (target === undefined) {
        await json(route, 404, errorBody('E_GEN_NOT_FOUND', 'Không tìm thấy', path));
        return;
      }
      if (options.forbidAccessFor?.includes(id) === true) {
        await json(route, 403, errorBody('E_RBAC_FORBIDDEN', 'SYSADMIN không được đổi quyền tài khoản OWNER.', path));
        return;
      }
      if (options.staleFirstSave === true && !staleServed) {
        staleServed = true;
        target.version += 5;
        target.role = 'RESERVATION_AGENT';
        await json(route, 412, errorBody('E_GEN_VERSION_CONFLICT', 'Phiên bản đã cũ', path));
        return;
      }
      if (ifMatch === undefined) {
        await json(route, 428, errorBody('E_GEN_PRECONDITION_REQUIRED', 'Thiếu If-Match', path));
        return;
      }
      if (ifMatch !== `"${target.version}"`) {
        await json(route, 412, errorBody('E_GEN_VERSION_CONFLICT', 'Phiên bản đã cũ', path));
        return;
      }
      target.role = body.role as Role;
      target.propertyScope = Array.isArray(body.propertyScope) ? body.propertyScope.map(String) : [];
      target.isActive = body.isActive === true;
      target.version += 1;
      await json(route, 200, JSON.stringify(target), { etag: `"${target.version}"` });
      return;
    }
    const pin = /^\/users\/([^/]+)\/pin$/.exec(path);
    if (method === 'DELETE' && pin !== null) {
      const id = decodeURIComponent(pin[1] ?? '');
      spy.pinDeletes.push(id);
      const target = users.find((user) => user.id === id);
      if (target !== undefined) target.hasPin = false;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fallback();
  });
  return spy;
}
