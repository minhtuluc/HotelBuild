import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { createUserRequestSchema, userAccessUpdateRequestSchema } from '@pinehill/contracts';
import type { UserSummary } from '@pinehill/contracts';
import {
  TEMP_PASSWORD_LENGTH,
  accessChanged,
  canonicalPhone,
  accessDraft,
  assignableRoles,
  canClearPin,
  canManageUsers,
  createIssues,
  generateTemporaryPassword,
  ifMatchOf,
  isLocked,
  parseScopeInput,
  toAccessRequest,
  toCreateRequest,
  usersQuery,
  writeFailure,
} from '../../src/app/(ops)/admin/users/users-model';

const USER: UserSummary = {
  id: 'u1',
  username: 'le.tan',
  fullName: 'Lê Tân',
  role: 'FRONT_DESK',
  propertyScope: ['p1'],
  isActive: true,
  lockedUntil: null,
  hasPin: true,
  version: 4,
};

/** Nguồn ngẫu nhiên xác định: byte i = (i * 37 + seed) % 256, để kiểm cách dùng chứ không kiểm entropy. */
const bytes = (seed: number) => (size: number) =>
  Uint8Array.from({ length: size }, (_, i) => (i * 37 + seed) % 256);

describe('quyền hiển thị (chỉ ẩn, máy chủ vẫn cưỡng chế)', () => {
  it('OWNER gán mọi vai trò; SYSADMIN trừ OWNER và SYSADMIN; vai trò khác không gán', () => {
    expect(assignableRoles('OWNER')).toHaveLength(7);
    const sysadmin = assignableRoles('SYSADMIN');
    expect(sysadmin).not.toContain('OWNER');
    expect(sysadmin).not.toContain('SYSADMIN');
    expect(sysadmin).toContain('MANAGER');
    expect(assignableRoles('MANAGER')).toEqual([]);
    expect(assignableRoles('FRONT_DESK')).toEqual([]);
  });

  it('chỉ OWNER/SYSADMIN quản lý; xoá PIN thêm MANAGER', () => {
    expect(canManageUsers('OWNER')).toBe(true);
    expect(canManageUsers('SYSADMIN')).toBe(true);
    expect(canManageUsers('MANAGER')).toBe(false);
    expect(canClearPin('MANAGER')).toBe(true);
    expect(canClearPin('SYSADMIN')).toBe(true);
    expect(canClearPin('FRONT_DESK')).toBe(false);
  });
});

describe('mật khẩu tạm', () => {
  it('sinh đúng độ dài, đủ chữ hoa/thường/số, không ký tự dễ nhầm, và không dùng Math.random', () => {
    const spy = Math.random;
    Math.random = () => {
      throw new Error('Math.random bị cấm');
    };
    try {
      for (const seed of [0, 1, 7, 99, 200]) {
        const password = generateTemporaryPassword(bytes(seed));
        expect(password).toHaveLength(TEMP_PASSWORD_LENGTH);
        expect(password).toMatch(/[A-Z]/);
        expect(password).toMatch(/[a-z]/);
        expect(password).toMatch(/\d/);
        expect(password).not.toMatch(/[0OIl1]/);
      }
    } finally {
      Math.random = spy;
    }
  });

  it('bỏ byte rơi vào vùng lệch (rejection sampling) và xin thêm byte khi thiếu', () => {
    let calls = 0;
    const biased = (size: number) => {
      calls += 1;
      // lần đầu toàn byte 255 (vùng lệch, bị bỏ); lần sau byte hợp lệ
      return calls === 1 ? new Uint8Array(size).fill(255) : bytes(calls)(size);
    };
    const password = generateTemporaryPassword(biased);
    expect(password).toHaveLength(TEMP_PASSWORD_LENGTH);
    expect(calls).toBeGreaterThan(1);
  });

  it('mật khẩu sinh ra thoả hợp đồng tạo người dùng (8–128 ký tự)', () => {
    const request = toCreateRequest(
      { username: 'moi.nv', fullName: 'Mới', phone: '', role: 'FRONT_DESK', propertyScope: ['p1'] },
      generateTemporaryPassword(bytes(3)),
    );
    expect(createUserRequestSchema.safeParse(request).success).toBe(true);
  });
});

describe('biểu mẫu tạo', () => {
  const ok = {
    username: 'moi.nv',
    fullName: 'Mới',
    phone: '',
    role: 'FRONT_DESK' as const,
    propertyScope: ['p1'],
  };
  it('hợp lệ thì không có lỗi; phone rỗng bị bỏ khỏi thân lệnh', () => {
    expect(createIssues(ok)).toEqual([]);
    expect(toCreateRequest(ok, 'Abcdefg2hjk')).not.toHaveProperty('phone');
  });
  it('báo lỗi theo trường', () => {
    expect(createIssues({ ...ok, username: 'ab' })).toEqual([
      { field: 'username', issue: 'SHORT' },
    ]);
    expect(createIssues({ ...ok, fullName: '  ' })).toEqual([
      { field: 'fullName', issue: 'REQUIRED' },
    ]);
    expect(createIssues({ ...ok, phone: '12345' })).toEqual([{ field: 'phone', issue: 'FORMAT' }]);
    expect(createIssues({ ...ok, phone: '0912345678' })).toEqual([]);
    expect(createIssues({ ...ok, phone: '+84912345678' })).toEqual([]);
    expect(createIssues({ ...ok, propertyScope: [] })).toEqual([
      { field: 'propertyScope', issue: 'REQUIRED' },
    ]);
  });
  it('OWNER không cần phạm vi cơ sở (máy chủ vẫn quyết)', () => {
    expect(createIssues({ ...ok, role: 'OWNER', propertyScope: [] })).toEqual([]);
  });
  it('cắt khoảng trắng và gửi đúng schema', () => {
    const request = toCreateRequest(
      { ...ok, username: ' moi.nv ', fullName: ' Mới ', phone: ' 0912345678 ' },
      'Abcdefg2hjk',
    );
    expect(request).toMatchObject({ username: 'moi.nv', fullName: 'Mới', phone: '+84912345678' });
    expect(createUserRequestSchema.safeParse(request).success).toBe(true);
  });
});

describe('số điện thoại', () => {
  it('đổi đầu 0 thành +84 theo hợp đồng, giữ nguyên dạng +84', () => {
    expect(canonicalPhone(' 0912345678 ')).toBe('+84912345678');
    expect(canonicalPhone('+84912345678')).toBe('+84912345678');
  });
});

describe('sửa quyền', () => {
  it('bản nháp bắt đầu từ bản ghi máy chủ và chưa thay đổi', () => {
    const draft = accessDraft(USER);
    expect(accessChanged(USER, draft)).toBe(false);
    expect(toAccessRequest(draft)).toEqual({
      role: 'FRONT_DESK',
      propertyScope: ['p1'],
      isActive: true,
    });
    expect(userAccessUpdateRequestSchema.safeParse(toAccessRequest(draft)).success).toBe(true);
  });
  it('thứ tự phạm vi không phải thay đổi; đổi vai trò/cơ sở/trạng thái là thay đổi', () => {
    const user = { ...USER, propertyScope: ['p1', 'p2'] };
    expect(accessChanged(user, { ...accessDraft(user), propertyScope: ['p2', 'p1'] })).toBe(false);
    expect(accessChanged(user, { ...accessDraft(user), role: 'MANAGER' })).toBe(true);
    expect(accessChanged(user, { ...accessDraft(user), isActive: false })).toBe(true);
    expect(accessChanged(user, { ...accessDraft(user), propertyScope: ['p1'] })).toBe(true);
  });
  it('If-Match là phiên bản có dấu ngoặc kép (api.md §1.3)', () => {
    expect(ifMatchOf(4)).toBe('"4"');
  });
});

describe('phạm vi nhập tay (khi chưa đọc được danh sách cơ sở)', () => {
  it('tách theo dấu phẩy/khoảng trắng, bỏ trùng và rỗng', () => {
    expect(parseScopeInput(' p1, p2  p1,,')).toEqual(['p1', 'p2']);
    expect(parseScopeInput('')).toEqual([]);
  });
});

describe('bộ lọc và khoá', () => {
  it('chỉ đưa vào truy vấn các giá trị có nghĩa, kèm con trỏ', () => {
    expect(usersQuery({ role: '', propertyId: '', q: '  ' }, undefined)).toEqual({ limit: 20 });
    expect(usersQuery({ role: 'MANAGER', propertyId: 'p1', q: ' an ' }, 'c2')).toEqual({
      limit: 20,
      role: 'MANAGER',
      propertyId: 'p1',
      q: 'an',
      cursor: 'c2',
    });
  });
  it('lockedUntil trong tương lai là đang khoá (chỉ hiển thị)', () => {
    const now = Date.parse('2026-10-22T00:00:00Z');
    expect(isLocked({ ...USER, lockedUntil: '2026-10-22T00:15:00Z' }, now)).toBe(true);
    expect(isLocked({ ...USER, lockedUntil: '2026-10-21T23:00:00Z' }, now)).toBe(false);
    expect(isLocked(USER, now)).toBe(false);
  });
});

describe('phân loại lỗi ghi', () => {
  const http = (status: number, code: string, message = 'm') =>
    new ApiError({ kind: 'http', status, code, message, traceId: 't1' });
  it('403 hiện nguyên mã + lý do máy chủ (không đổi thành thiếu quyền toàn màn)', () => {
    expect(writeFailure(http(403, 'E_RBAC_FORBIDDEN', 'Không được gán OWNER'))).toEqual({
      kind: 'rejected',
      code: 'E_RBAC_FORBIDDEN',
      status: 403,
      reason: 'Không được gán OWNER',
    });
  });
  it('412/428 là xung đột phiên bản; 401 là hết phiên', () => {
    expect(writeFailure(http(412, 'E_GEN_VERSION_CONFLICT'))).toEqual({ kind: 'conflict' });
    expect(writeFailure(http(428, 'E_GEN_PRECONDITION_REQUIRED'))).toEqual({ kind: 'conflict' });
    expect(writeFailure(http(401, 'E_AUTH_INVALID_CREDENTIALS'))).toEqual({ kind: 'expired' });
  });
  it('409 tên đăng nhập trùng là từ chối chắc chắn', () => {
    expect(writeFailure(http(409, 'E_AUTH_USERNAME_TAKEN')).kind).toBe('rejected');
  });
  it('400/422 kèm details trả lỗi theo trường', () => {
    const error = new ApiError({
      kind: 'http',
      status: 422,
      code: 'E_GEN_VALIDATION_FAILED',
      message: 'x',
      details: [{ field: 'phone', issue: 'FORMAT' }],
    });
    expect(writeFailure(error)).toEqual({
      kind: 'validation',
      details: [{ field: 'phone', issue: 'FORMAT' }],
    });
  });
  it('mạng/hết giờ/5xx là chưa xác định kết quả, kèm mã tham chiếu', () => {
    expect(writeFailure(new ApiError({ kind: 'network', message: 'down' }))).toEqual({
      kind: 'unknownOutcome',
      reference: '—',
    });
    expect(writeFailure(http(503, 'E_SYS_UNAVAILABLE'))).toEqual({
      kind: 'unknownOutcome',
      reference: 't1',
    });
    expect(writeFailure(new Error('boom')).kind).toBe('unknownOutcome');
  });
});
