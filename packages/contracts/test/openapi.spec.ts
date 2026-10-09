import { describe, expect, it } from 'vitest';
import { isErrorCode } from '../src/errors.js';
import { buildDocument, CONTRACT_VERSION, serializeDocument } from '../src/openapi/generate.js';

/** Đọc tên tham số của một operation mà không cần ép kiểu. */
function parameterName(parameter: unknown): string | undefined {
  if (typeof parameter !== 'object' || parameter === null) return undefined;
  const candidate = 'name' in parameter ? parameter.name : undefined;
  return typeof candidate === 'string' ? candidate : undefined;
}

function schemeNames(requirement: unknown): string[] {
  if (typeof requirement !== 'object' || requirement === null) return [];
  return Object.keys(requirement);
}

/** Danh sách scheme bảo mật khai cho một operation, hoặc undefined nếu công khai. */
function securityOf(operation: unknown): string[] | undefined {
  if (typeof operation !== 'object' || operation === null) return undefined;
  if (!('security' in operation)) return undefined;
  const { security } = operation;
  if (!Array.isArray(security)) return undefined;
  const names: string[] = [];
  for (const requirement of security) names.push(...schemeNames(requirement));
  return names;
}

function hasParameterNamed(operation: unknown, name: string): boolean {
  if (typeof operation !== 'object' || operation === null) return false;
  const parameters = 'parameters' in operation ? operation.parameters : undefined;
  return (
    Array.isArray(parameters) &&
    parameters.some((parameter: unknown) => parameterName(parameter) === name)
  );
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Bảng phân loại công khai/cần token theo api.md §2.1 và §6.1. */
const AUTH_OPERATIONS: readonly (readonly [Method, string, 'public' | 'bearer'])[] = [
  ['post', '/api/v1/auth/login', 'public'],
  ['post', '/api/v1/auth/refresh', 'public'],
  ['post', '/api/v1/guest-auth/login', 'public'],
  ['post', '/api/v1/guest-auth/register', 'public'],
  ['post', '/api/v1/guest-auth/refresh', 'public'],
  ['get', '/api/v1/system/health', 'public'],
  ['post', '/api/v1/auth/pin/verify', 'bearer'],
  ['post', '/api/v1/auth/logout', 'bearer'],
  ['get', '/api/v1/auth/me', 'bearer'],
  ['put', '/api/v1/users/{userId}/access', 'bearer'],
  ['get', '/api/v1/users', 'bearer'],
  ['post', '/api/v1/users', 'bearer'],
  ['delete', '/api/v1/users/{userId}/pin', 'bearer'],
  ['post', '/api/v1/auth/password', 'bearer'],
  ['put', '/api/v1/auth/pin', 'bearer'],
  ['post', '/api/v1/guest-auth/password-reset/request', 'public'],
  ['post', '/api/v1/guest-auth/password-reset/confirm', 'public'],
  ['get', '/api/v1/properties', 'bearer'],
  ['patch', '/api/v1/properties/{propertyId}', 'bearer'],
  ['post', '/api/v1/room-types', 'bearer'],
  ['get', '/api/v1/room-types', 'bearer'],
  ['get', '/api/v1/rooms', 'bearer'],
  ['put', '/api/v1/rooms/{roomId}/connecting-room', 'bearer'],
  // HB-039: bổ sung tuyến đọc khoá phòng cho SCR-22 (thêm tuyến, không phá vỡ hợp đồng).
  ['get', '/api/v1/room-blocks', 'bearer'],
  ['post', '/api/v1/room-blocks', 'bearer'],
  ['delete', '/api/v1/room-blocks/{roomBlockId}', 'bearer'],
  ['get', '/api/v1/inventory/grid', 'bearer'],
  ['get', '/api/v1/channel-allotments', 'bearer'],
  ['put', '/api/v1/channel-allotments', 'bearer'],
  ['get', '/api/v1/audit-logs', 'bearer'],
  // HB-044: bổ sung tuyến đọc tham số cho SCR-17 (thêm tuyến, không phá vỡ hợp đồng).
  ['get', '/api/v1/system-settings', 'bearer'],
  ['put', '/api/v1/system-settings/{key}', 'bearer'],
  ['post', '/api/v1/system/backups', 'bearer'],
  ['post', '/api/v1/system/backups/{backupId}/restore', 'bearer'],
  ['get', '/api/v1/operations/{operationId}', 'bearer'],
  ['get', '/api/v1/room-types/{roomTypeId}/rate-calendar', 'bearer'],
  ['put', '/api/v1/room-types/{roomTypeId}/rate-calendar', 'bearer'],
  // HB-059: bổ sung tuyến đọc mùa cho SCR-27 (thêm tuyến, không phá vỡ hợp đồng).
  ['get', '/api/v1/seasons', 'bearer'],
  ['post', '/api/v1/seasons', 'bearer'],
  // HB-060/HB-042: bổ sung tuyến đọc kênh (thêm tuyến, không phá vỡ hợp đồng).
  ['get', '/api/v1/channels', 'bearer'],
  ['get', '/api/v1/channels/{channelId}', 'bearer'],
  ['patch', '/api/v1/channels/{channelId}', 'bearer'],
  // HB-061: bổ sung tuyến đọc khuyến mãi cho SCR-29 (thêm tuyến, không phá vỡ hợp đồng).
  ['get', '/api/v1/promotions', 'bearer'],
  ['post', '/api/v1/promotions', 'bearer'],
  ['post', '/api/v1/quotes/multi-channel', 'bearer'],
  ['get', '/api/v1/rate-plans', 'public'],
  ['put', '/api/v1/rate-plans/{ratePlanId}', 'bearer'],
  ['get', '/api/v1/cancellation-policies', 'bearer'],
  ['put', '/api/v1/cancellation-policies/{policyId}', 'bearer'],
  // F4 (HB-070): availability và quotes công khai; bookings/holds cần Bearer.
  ['get', '/api/v1/inventory/availability', 'public'],
  ['post', '/api/v1/quotes', 'public'],
  ['post', '/api/v1/bookings', 'bearer'],
  ['get', '/api/v1/bookings', 'bearer'],
  ['get', '/api/v1/bookings/{bookingId}', 'bearer'],
  ['post', '/api/v1/bookings/{bookingId}/confirm', 'bearer'],
  ['post', '/api/v1/holds', 'bearer'],
  ['delete', '/api/v1/holds/{holdId}', 'bearer'],
  // F5 (HB-090): vòng đời booking, thanh toán và hoàn tiền đều cần Bearer.
  ['post', '/api/v1/bookings/{bookingId}/cancel-preview', 'bearer'],
  ['post', '/api/v1/bookings/{bookingId}/cancel', 'bearer'],
  ['post', '/api/v1/bookings/{bookingId}/reschedule', 'bearer'],
  ['delete', '/api/v1/bookings/{bookingId}', 'bearer'],
  ['post', '/api/v1/payments', 'bearer'],
  ['post', '/api/v1/payments/online', 'bearer'],
  ['get', '/api/v1/payments/{paymentId}/status', 'bearer'],
  ['get', '/api/v1/bookings/{bookingId}/balance', 'bearer'],
  ['post', '/api/v1/refund-requests', 'bearer'],
  ['get', '/api/v1/refund-requests', 'bearer'],
  ['post', '/api/v1/refund-requests/{refundRequestId}/approve', 'bearer'],
  ['post', '/api/v1/refund-requests/{refundRequestId}/reject', 'bearer'],
  ['post', '/api/v1/refund-requests/{refundRequestId}/cancel', 'bearer'],
  ['post', '/api/v1/refund-requests/{refundRequestId}/pay', 'bearer'],
  // F7 (HB-140): tiền sảnh, buồng phòng, khách tại quầy, chốt đối soát.
  ['post', '/api/v1/front-office/check-in', 'bearer'],
  ['post', '/api/v1/front-office/check-out', 'bearer'],
  ['post', '/api/v1/front-office/no-show', 'bearer'],
  ['get', '/api/v1/housekeeping/tasks', 'bearer'],
  ['patch', '/api/v1/housekeeping/tasks/{taskId}', 'bearer'],
  ['get', '/api/v1/guests', 'bearer'],
  ['post', '/api/v1/guests', 'bearer'],
  // HB-105: khách tự đọc hồ sơ/điểm của chính mình (phiên khách).
  ['get', '/api/v1/guests/me', 'bearer'],
  ['get', '/api/v1/guests/me/loyalty', 'bearer'],
  ['post', '/api/v1/reconciliation/daily/close', 'bearer'],
  // F8 (HB-160): báo cáo, xuất báo cáo, thông báo, CRM quản trị.
  ['get', '/api/v1/reports/occupancy', 'bearer'],
  ['get', '/api/v1/reports/adr-revpar', 'bearer'],
  ['get', '/api/v1/reports/revenue-by-channel', 'bearer'],
  ['get', '/api/v1/reports/cancellations', 'bearer'],
  ['get', '/api/v1/reports/force-majeure', 'bearer'],
  ['get', '/api/v1/reports/overbooking', 'bearer'],
  ['post', '/api/v1/reports/export', 'bearer'],
  ['post', '/api/v1/guests/{guestId}/anonymize', 'bearer'],
  ['get', '/api/v1/guests/{guestId}/loyalty', 'bearer'],
  ['post', '/api/v1/guests/{guestId}/blacklist', 'bearer'],
  ['delete', '/api/v1/guests/{guestId}/blacklist', 'bearer'],
  ['get', '/api/v1/notifications', 'bearer'],
  ['post', '/api/v1/notifications/{notificationId}/resend', 'bearer'],
];

const WRITE_TARGETS = AUTH_OPERATIONS.filter(([method]) => method !== 'get');

describe('OpenAPI 3.1 sinh từ zod', () => {
  const document = buildDocument();

  function operationAt(method: Method, path: string): unknown {
    const item = document.paths?.[path];
    if (item === undefined) return undefined;
    return item[method];
  }

  it('khai báo phiên bản 3.1 và phiên bản hợp đồng', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(CONTRACT_VERSION);
  });

  it('có đủ 85 path của F0…F5 + F7 + F8 (kèm tuyến đọc bổ sung F2/F3 và tuyến self của HB-105)', () => {
    expect(Object.keys(document.paths ?? {}).sort()).toEqual(
      [
        '/api/v1/auth/login',
        '/api/v1/auth/logout',
        '/api/v1/auth/me',
        '/api/v1/auth/password',
        '/api/v1/auth/pin',
        '/api/v1/auth/pin/verify',
        '/api/v1/auth/refresh',
        '/api/v1/guest-auth/login',
        '/api/v1/guest-auth/password-reset/confirm',
        '/api/v1/guest-auth/password-reset/request',
        '/api/v1/guest-auth/refresh',
        '/api/v1/guest-auth/register',
        '/api/v1/system/health',
        '/api/v1/users',
        '/api/v1/users/{userId}/access',
        '/api/v1/users/{userId}/pin',
        '/api/v1/properties',
        '/api/v1/public/properties',
        '/api/v1/properties/{propertyId}',
        '/api/v1/room-types',
        '/api/v1/rooms',
        '/api/v1/rooms/{roomId}/connecting-room',
        '/api/v1/room-blocks',
        '/api/v1/room-blocks/{roomBlockId}',
        '/api/v1/inventory/grid',
        '/api/v1/channel-allotments',
        '/api/v1/audit-logs',
        '/api/v1/system-settings',
        '/api/v1/system-settings/{key}',
        '/api/v1/system/backups',
        '/api/v1/system/backups/{backupId}/restore',
        '/api/v1/operations/{operationId}',
        '/api/v1/room-types/{roomTypeId}/rate-calendar',
        '/api/v1/seasons',
        '/api/v1/channels',
        '/api/v1/channels/{channelId}',
        '/api/v1/promotions',
        '/api/v1/quotes/multi-channel',
        '/api/v1/rate-plans',
        '/api/v1/rate-plans/admin',
        '/api/v1/rate-plans/{ratePlanId}',
        '/api/v1/cancellation-policies',
        '/api/v1/cancellation-policies/{policyId}',
        '/api/v1/inventory/availability',
        '/api/v1/quotes',
        '/api/v1/bookings',
        '/api/v1/bookings/{bookingId}',
        '/api/v1/bookings/{bookingId}/confirm',
        '/api/v1/holds',
        '/api/v1/holds/{holdId}',
        '/api/v1/bookings/{bookingId}/cancel-preview',
        '/api/v1/bookings/{bookingId}/cancel',
        '/api/v1/bookings/{bookingId}/reschedule',
        '/api/v1/bookings/{bookingId}/balance',
        '/api/v1/payments',
        '/api/v1/payments/online',
        '/api/v1/payments/{paymentId}/status',
        '/api/v1/refund-requests',
        '/api/v1/refund-requests/{refundRequestId}/approve',
        '/api/v1/refund-requests/{refundRequestId}/reject',
        '/api/v1/refund-requests/{refundRequestId}/cancel',
        '/api/v1/refund-requests/{refundRequestId}/pay',
        '/api/v1/front-office/check-in',
        '/api/v1/front-office/check-out',
        '/api/v1/front-office/no-show',
        '/api/v1/housekeeping/tasks',
        '/api/v1/housekeeping/tasks/{taskId}',
        '/api/v1/guests',
        '/api/v1/guests/me',
        '/api/v1/guests/me/loyalty',
        '/api/v1/reconciliation/daily/close',
        '/api/v1/reports/occupancy',
        '/api/v1/reports/adr-revpar',
        '/api/v1/reports/revenue-by-channel',
        '/api/v1/reports/cancellations',
        '/api/v1/reports/force-majeure',
        '/api/v1/reports/overbooking',
        '/api/v1/reports/export',
        '/api/v1/guests/{guestId}/anonymize',
        '/api/v1/guests/{guestId}/loyalty',
        '/api/v1/guests/{guestId}/blacklist',
        '/api/v1/notifications',
        '/api/v1/notifications/{notificationId}/resend',
        '/api/v1/integrations/psp/vnpay/callback',
        '/api/v1/integrations/psp/momo/callback',
      ].sort(),
    );
  });

  it('mọi mã E_* xuất hiện trong tài liệu đều thuộc danh mục §4.2', () => {
    const tokens = serializeDocument().match(/E_[A-Z]+_[A-Z_]+/g) ?? [];
    expect(tokens.length).toBeGreaterThanOrEqual(10);
    for (const token of new Set(tokens)) expect(isErrorCode(token), `mã lạ: ${token}`).toBe(true);
  });

  it('mọi lệnh ghi yêu cầu Idempotency-Key và mọi lệnh gửi được mã tương quan', () => {
    for (const [method, path] of WRITE_TARGETS) {
      const operation = operationAt(method, path);
      const label = `${method.toUpperCase()} ${path}`;
      expect(hasParameterNamed(operation, 'Idempotency-Key'), label).toBe(true);
      expect(hasParameterNamed(operation, 'X-Correlation-Id'), label).toBe(true);
    }
  });

  it('phản hồi lỗi của login trỏ đúng mã trong danh mục', () => {
    const login = document.paths?.['/api/v1/auth/login']?.post;
    expect(login?.responses?.['401']).toMatchObject({
      description: 'E_AUTH_INVALID_CREDENTIALS, E_AUTH_ACCOUNT_LOCKED',
    });
    expect(login?.responses?.['429']).toMatchObject({ description: 'E_GEN_RATE_LIMITED' });
    expect(login?.responses?.['400']).toMatchObject({ description: 'E_GEN_VALIDATION_FAILED' });
  });

  it('chỉ một nơi chứa tiền tố /api/v1 nên URL ghép không bị lặp (F0-01)', () => {
    const servers = document.servers ?? [];
    expect(servers).toHaveLength(1);
    const serverUrl = servers[0]?.url ?? '';
    expect(serverUrl).not.toContain('/api/v1');
    for (const path of Object.keys(document.paths ?? {})) {
      expect(path.startsWith('/api/v1/'), `path thiếu tiền tố: ${path}`).toBe(true);
      const effective = `${serverUrl.replace(/\/$/, '')}${path}`;
      expect(effective.match(/\/api\/v1/g) ?? [], `lặp tiền tố: ${effective}`).toHaveLength(1);
    }
  });

  it('endpoint công khai không khai security, endpoint cần token có bearerAuth (F0-01)', () => {
    for (const [method, path, expectation] of AUTH_OPERATIONS) {
      const label = `${method.toUpperCase()} ${path}`;
      const security = securityOf(operationAt(method, path));
      if (expectation === 'public') expect(security, label).toBeUndefined();
      else expect(security, label).toContain('bearerAuth');
    }
  });

  it('sinh tất định: hai lần sinh cho ra chuỗi giống nhau', () => {
    expect(serializeDocument()).toBe(serializeDocument());
  });

  it('có component ErrorBody dùng chung', () => {
    expect(Object.keys(document.components?.schemas ?? {})).toContain('ErrorBody');
  });

  it('tuyến đọc khoá phòng phục vụ SCR-22 (HB-039): chỉ GET, không thêm tuyến ghi', () => {
    const blocks = document.paths?.['/api/v1/room-blocks'] ?? {};
    expect(Object.keys(blocks).sort()).toEqual(['get', 'post']);
    const list = document.paths?.['/api/v1/room-blocks']?.get;
    expect(JSON.stringify(list)).toContain('propertyId');
    expect(JSON.stringify(list)).toContain('roomId');
  });

  it('tuyến đọc mùa phục vụ SCR-27 (HB-059): GET + POST, không có tuyến ghi khác', () => {
    const seasons = document.paths?.['/api/v1/seasons'] ?? {};
    expect(Object.keys(seasons).sort()).toEqual(['get', 'post']);
    expect(JSON.stringify(seasons.get)).toContain('propertyId');
  });

  it('DTO buồng phòng là projection tối thiểu, không có booking/khách/tiền (HB-140 AC3)', () => {
    const task = document.paths?.['/api/v1/housekeeping/tasks']?.get;
    const serialized = JSON.stringify(task).toLowerCase();
    for (const forbidden of [
      'bookingid',
      'guestid',
      'guestname',
      'amount',
      'paidamount',
      'balance',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    const patch = document.paths?.['/api/v1/housekeeping/tasks/{taskId}']?.patch;
    expect(JSON.stringify(patch)).toContain('If-Match');
  });

  it('không có DELETE /guests/{guestId} — chỉ ẩn danh hoá (§2.14, BR-CRM-05, HB-160 AC3)', () => {
    const guest = document.paths?.['/api/v1/guests/{guestId}'] ?? {};
    expect(Object.keys(guest)).toEqual([]);
    expect(document.paths?.['/api/v1/guests/{guestId}/anonymize']?.post).toBeDefined();
  });

  it('xuất báo cáo trả 202 kèm tham chiếu tác vụ (NFR-COMP-04, HB-160 AC3)', () => {
    const exported = document.paths?.['/api/v1/reports/export']?.post;
    expect(exported?.responses?.['202']).toBeDefined();
    expect(JSON.stringify(exported)).toContain('operationId');
  });

  it('không khai tuyến ghi lên audit-logs hay price snapshot (§2.14, BR-SYS-01, BR-RATE-16)', () => {
    const audit = document.paths?.['/api/v1/audit-logs'] ?? {};
    expect(Object.keys(audit)).toEqual(['get']);
    for (const path of Object.keys(document.paths ?? {})) {
      expect(path.includes('price-snapshot'), `tuyến cấm: ${path}`).toBe(false);
    }
  });

  it('lưới tồn chặn khoảng quá 31 ngày ngay ở schema (HB-030)', () => {
    const grid = document.paths?.['/api/v1/inventory/grid']?.get;
    expect(grid).toBeDefined();
    expect(JSON.stringify(grid)).toContain('31');
  });

  it('chính sách huỷ nhận toàn bộ bậc với phần trăm 0–100 và mốc giờ ≥ 0 (HB-050 AC3)', () => {
    const policy = document.paths?.['/api/v1/cancellation-policies/{policyId}']?.put;
    expect(policy).toBeDefined();
    expect(JSON.stringify(policy)).toContain('hoursBeforeCheckIn');
    expect(JSON.stringify(policy)).toContain('tiers');
  });
});
