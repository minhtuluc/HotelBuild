/**
 * API giả cho SCR-14 (HB-020): hồ sơ phiên, danh sách cơ sở và đổi mật khẩu cho các tài khoản có tiền tố
 * `ops-auth-`. Các tài khoản khác được bỏ qua (trả `undefined`) để plugin `f5` vẫn phục vụ `GET /auth/me`
 * như cũ cho mọi E2E hiện có. Đăng nhập/làm mới/khoá do plugin `core` lo (`/__control/<username>`).
 *
 * Quy ước tên: `ops-auth-must-…` buộc đổi mật khẩu tới khi gọi đổi thành công; `ops-auth-multi-…` là MANAGER
 * của 2 cơ sở; `ops-auth-owner-…` là OWNER (thấy 3 cơ sở, phạm vi rỗng); còn lại là FRONT_DESK 1 cơ sở.
 */
import type { FakeApiContext, FakeHandler, FakeRequest, FakeResponse } from '../core/types.js';

const PREFIX = 'ops-auth-';
const PASSWORD = 'Synthetic-password';

export const OPS_AUTH_PROPERTIES = [
  { id: 'p-dalat', name: 'Pine Hill Đà Lạt' },
  { id: 'p-nhatrang', name: 'Pine Hill Nha Trang' },
  { id: 'p-vungtau', name: 'Pine Hill Vũng Tàu' },
] as const;

function error(request: FakeRequest, status: number, code: string): FakeResponse {
  return {
    status,
    body: {
      code,
      message: 'Synthetic failure',
      traceId: 'fake-ops-auth-trace',
      timestamp: '2026-10-22T00:00:00.000Z',
      path: request.url.pathname,
    },
  };
}

function profileOf(key: string) {
  if (key.startsWith(`${PREFIX}owner-`))
    return { role: 'OWNER' as const, propertyScope: [] as string[] };
  if (key.startsWith(`${PREFIX}multi-`))
    return { role: 'MANAGER' as const, propertyScope: ['p-dalat', 'p-nhatrang'] };
  return { role: 'FRONT_DESK' as const, propertyScope: ['p-dalat'] };
}

function property(entry: (typeof OPS_AUTH_PROPERTIES)[number]) {
  return {
    ...entry,
    status: 'ACTIVE',
    activeRoomCount: 10,
    overbookLimitPct: 5,
    checkInTime: '14:00',
    checkOutTime: '12:00',
    version: 1,
  };
}

export function createHandler(context: FakeApiContext): FakeHandler {
  const passwords = new Map<string, string>();
  const changed = new Set<string>();
  return (request) => {
    const path = request.url.pathname;
    if (!['/api/v1/auth/me', '/api/v1/auth/change-password', '/api/v1/properties'].includes(path))
      return undefined;
    const actor = context.authenticateActor?.(request.authorization);
    if (actor === undefined || !actor.key.startsWith(PREFIX)) return undefined;
    const { role, propertyScope } = profileOf(actor.key);
    if (path === '/api/v1/auth/me' && request.method === 'GET')
      return {
        status: 200,
        body: {
          userId: actor.key,
          username: actor.key,
          fullName: 'Nhân viên SCR-14',
          role,
          propertyScope,
          hasPin: true,
          mustChangePassword: actor.key.startsWith(`${PREFIX}must-`) && !changed.has(actor.key),
        },
      };
    if (path === '/api/v1/properties' && request.method === 'GET') {
      const visible = OPS_AUTH_PROPERTIES.filter(
        (entry) => role === 'OWNER' || propertyScope.includes(entry.id),
      );
      return {
        status: 200,
        body: {
          data: visible.map(property),
          meta: { limit: 100, total: visible.length, hasMore: false, nextCursor: null },
        },
      };
    }
    if (path === '/api/v1/auth/change-password' && request.method === 'POST') {
      const body: unknown = request.body;
      const fields = typeof body === 'object' && body !== null ? body : {};
      const currentPassword = 'currentPassword' in fields ? fields.currentPassword : undefined;
      const newPassword = 'newPassword' in fields ? fields.newPassword : undefined;
      if (typeof newPassword !== 'string' || newPassword.length < 8)
        return error(request, 400, 'E_GEN_VALIDATION_FAILED');
      if (currentPassword !== (passwords.get(actor.key) ?? PASSWORD))
        return error(request, 401, 'E_AUTH_INVALID_CREDENTIALS');
      passwords.set(actor.key, newPassword);
      changed.add(actor.key);
      return { status: 204 };
    }
    return undefined;
  };
}
