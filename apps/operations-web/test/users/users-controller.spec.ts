import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { ListPage, UserMe, UserSummary } from '@pinehill/contracts';
import { UsersController, type UsersPorts } from '../../src/app/(ops)/admin/users/controller';

const user = (id: string, over: Partial<UserSummary> = {}): UserSummary => ({
  id,
  username: `nv.${id}`,
  fullName: `Nhân viên ${id}`,
  role: 'FRONT_DESK',
  propertyScope: ['p1'],
  isActive: true,
  lockedUntil: null,
  hasPin: true,
  version: 4,
  ...over,
});
const page = (data: UserSummary[], next: string | null = null): ListPage<UserSummary> => ({
  data,
  meta: { limit: 20, total: data.length, hasMore: next !== null, nextCursor: next },
});
const owner: UserMe = {
  userId: 'me',
  username: 'chu',
  fullName: 'Chủ',
  role: 'OWNER',
  propertyScope: [],
  hasPin: true,
  mustChangePassword: false,
};
const http = (status: number, code: string, message = 'm') =>
  new ApiError({ kind: 'http', status, code, message, traceId: 'tr' });

function setup(over: Partial<UsersPorts> = {}) {
  let n = 0;
  const ports: UsersPorts = {
    actor: async () => owner,
    properties: async () => [{ id: 'p1', name: 'Đà Lạt' }],
    list: async () => page([user('a'), user('b')]),
    create: async (body) =>
      user('new', {
        username: body.username,
        fullName: body.fullName,
        role: body.role,
        version: 0,
      }),
    updateAccess: async (id, body) => user(id, { ...body, version: 5 }),
    deletePin: async () => undefined,
    random: (size) => Uint8Array.from({ length: size }, (_, i) => (i * 29 + 5) % 256),
    createId: () => `key-${++n}`,
    now: () => 1_000,
    ...over,
  };
  return { controller: new UsersController(ports), ports };
}

const draft = {
  username: 'moi.nv',
  fullName: 'Mới',
  phone: '',
  role: 'FRONT_DESK' as const,
  propertyScope: ['p1'],
};

describe('tải', () => {
  it('đọc hồ sơ phiên, cơ sở và trang đầu', async () => {
    const { controller } = setup();
    await controller.load();
    expect(controller.state).toMatchObject({ phase: 'ready', syncedAt: 1_000 });
    expect(controller.state.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(controller.state.actor?.role).toBe('OWNER');
    expect(controller.state.properties).toEqual([{ id: 'p1', name: 'Đà Lạt' }]);
  });

  it('không đọc được cơ sở (403) thì vẫn dùng được, chuyển sang nhập mã cơ sở', async () => {
    const { controller } = setup({
      properties: async () => {
        throw http(403, 'E_RBAC_FORBIDDEN');
      },
    });
    await controller.load();
    expect(controller.state.phase).toBe('ready');
    expect(controller.state.properties).toBeNull();
  });

  it.each([
    [403, 'forbidden'],
    [401, 'expired'],
    [500, 'error'],
  ] as const)('GET /users %s → %s, không bao giờ là danh sách rỗng', async (status, phase) => {
    const { controller } = setup({
      list: async () => {
        throw http(status, 'E_X');
      },
    });
    await controller.load();
    expect(controller.state.phase).toBe(phase);
    expect(controller.state.rows).toEqual([]);
  });

  it('401 khi đọc cơ sở là hết phiên', async () => {
    const { controller } = setup({
      properties: async () => {
        throw http(401, 'E_AUTH');
      },
    });
    await controller.load();
    expect(controller.state.phase).toBe('expired');
  });

  it('lỗi khi làm mới giữ nguyên dữ liệu cũ; 403 khi làm mới xoá dữ liệu', async () => {
    let fail: number | null = null;
    const { controller } = setup({
      list: async () => {
        if (fail !== null) throw http(fail, 'E_X');
        return page([user('a')]);
      },
    });
    await controller.load();
    fail = 500;
    await controller.reload();
    expect(controller.state.phase).toBe('ready');
    expect(controller.state.rows).toHaveLength(1);
    expect(controller.state.error).not.toBeNull();
    fail = 403;
    await controller.reload();
    expect(controller.state.phase).toBe('forbidden');
    expect(controller.state.rows).toEqual([]);
  });

  it('bộ lọc đi vào truy vấn, phản hồi cũ đến muộn bị bỏ', async () => {
    const queries: unknown[] = [];
    const gates: Array<() => void> = [];
    const { controller } = setup({
      list: async (query) => {
        queries.push(query);
        if (query.q === 'cu') await new Promise<void>((resolve) => gates.push(resolve));
        return page([user(query.q === 'cu' ? 'old' : 'new')]);
      },
    });
    const first = controller.reload({ role: '', propertyId: '', q: 'cu' });
    const second = controller.reload({ role: 'MANAGER', propertyId: 'p1', q: 'moi' });
    await second;
    gates[0]!();
    await first;
    expect(controller.state.rows.map((r) => r.id)).toEqual(['new']);
    expect(queries).toEqual([
      { limit: 20, q: 'cu' },
      { limit: 20, role: 'MANAGER', propertyId: 'p1', q: 'moi' },
    ]);
  });

  it('tải thêm nối trang và dừng khi hết con trỏ', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(page([user('a')], 'c2'))
      .mockResolvedValueOnce(page([user('b')]));
    const { controller } = setup({ list });
    await controller.load();
    expect(controller.state.nextCursor).toBe('c2');
    await controller.loadMore();
    expect(controller.state.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(controller.state.nextCursor).toBeNull();
    expect(list).toHaveBeenLastCalledWith({ limit: 20, cursor: 'c2' });
    await controller.loadMore();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('tạo người dùng', () => {
  it('biểu mẫu sai thì báo theo trường và không gọi máy chủ', async () => {
    const create = vi.fn();
    const { controller } = setup({ create });
    await controller.load();
    await controller.create({ ...draft, username: 'a' });
    expect(controller.state.issues).toEqual([{ field: 'username', issue: 'SHORT' }]);
    expect(create).not.toHaveBeenCalled();
  });

  it('thành công: mật khẩu tạm hiện một lần rồi bị xoá khỏi bộ nhớ', async () => {
    const create = vi.fn(
      async (body: { username: string; fullName: string; role: UserSummary['role'] }) =>
        user('new', {
          username: body.username,
          fullName: body.fullName,
          role: body.role,
          version: 0,
        }),
    );
    const { controller } = setup({ create });
    await controller.load();
    controller.openPanel({ kind: 'create' });
    await controller.create(draft);
    const handover = controller.state.handover;
    expect(handover?.password).toHaveLength(16);
    expect(create.mock.calls[0]![0]).toMatchObject({ temporaryPassword: handover?.password });
    expect(controller.state).toMatchObject({ panel: null, notice: 'created', busy: false });
    expect(controller.state.rows[0]?.id).toBe('new');
    controller.dismissHandover();
    expect(controller.state.handover).toBeNull();
    expect(JSON.stringify(controller.state)).not.toContain(handover!.password);
  });

  it('kết quả chưa xác định: thử lại cùng bản nháp dùng cùng khoá và cùng mật khẩu; đổi bản nháp thì khác', async () => {
    const seen: Array<{ key: string; password: string }> = [];
    let calls = 0;
    const { controller } = setup({
      create: async (body, key) => {
        seen.push({ key, password: body.temporaryPassword });
        if (++calls === 1) throw new ApiError({ kind: 'timeout', message: 'slow', traceId: 't9' });
        return user('new', { username: body.username, version: 0 });
      },
    });
    await controller.load();
    await controller.create(draft);
    expect(controller.state.failure).toEqual({ kind: 'unknownOutcome', reference: 't9' });
    await controller.create(draft);
    expect(seen[1]).toEqual(seen[0]);
    await controller.create({ ...draft, username: 'khac.nv' });
    expect(seen[2]!.key).not.toBe(seen[0]!.key);
  });

  it('từ chối chắc chắn (tên đăng nhập trùng) hiện mã máy chủ và không giữ khoá', async () => {
    const keys: string[] = [];
    const { controller } = setup({
      create: async (_body, key) => {
        keys.push(key);
        throw http(409, 'E_AUTH_USERNAME_TAKEN', 'Tên đăng nhập đã được dùng.');
      },
    });
    await controller.load();
    await controller.create(draft);
    expect(controller.state.failure).toEqual({
      kind: 'rejected',
      code: 'E_AUTH_USERNAME_TAKEN',
      status: 409,
      reason: 'Tên đăng nhập đã được dùng.',
    });
    expect(controller.state.handover).toBeNull();
    await controller.create(draft);
    expect(keys[1]).not.toBe(keys[0]);
  });
});

describe('sửa quyền', () => {
  it('gửi If-Match = phiên bản đang xem và thay dòng bằng bản máy chủ trả', async () => {
    const updateAccess = vi.fn(async (id: string, body: object) =>
      user(id, { ...body, version: 5 }),
    );
    const { controller } = setup({ updateAccess });
    await controller.load();
    await controller.saveAccess(user('a'), {
      role: 'MANAGER',
      propertyScope: ['p1'],
      isActive: true,
    });
    expect(updateAccess).toHaveBeenCalledWith(
      'a',
      { role: 'MANAGER', propertyScope: ['p1'], isActive: true },
      '"4"',
      'key-1',
    );
    expect(controller.state.rows.find((r) => r.id === 'a')).toMatchObject({
      role: 'MANAGER',
      version: 5,
    });
    expect(controller.state.notice).toBe('saved');
  });

  it('không thay đổi thì không gửi gì', async () => {
    const updateAccess = vi.fn();
    const { controller } = setup({ updateAccess });
    await controller.load();
    await controller.saveAccess(user('a'), {
      role: 'FRONT_DESK',
      propertyScope: ['p1'],
      isActive: true,
    });
    expect(updateAccess).not.toHaveBeenCalled();
  });

  it('412: báo xung đột và tải lại bản mới, không ghi đè', async () => {
    let version = 4;
    const list = vi.fn(async () => page([user('a', { version })]));
    const { controller } = setup({
      list,
      updateAccess: async () => {
        version = 9;
        throw http(412, 'E_GEN_VERSION_CONFLICT');
      },
    });
    await controller.load();
    await controller.saveAccess(user('a'), {
      role: 'MANAGER',
      propertyScope: ['p1'],
      isActive: true,
    });
    expect(controller.state.failure).toEqual({ kind: 'conflict' });
    expect(list).toHaveBeenCalledTimes(2);
    expect(controller.state.rows[0]?.version).toBe(9);
    expect(controller.state.rows[0]?.role).toBe('FRONT_DESK');
  });

  it('403 của máy chủ (SYSADMIN gán OWNER) hiện nguyên mã + lý do, vẫn ở màn hình', async () => {
    const { controller } = setup({
      updateAccess: async () => {
        throw http(403, 'E_RBAC_FORBIDDEN', 'SYSADMIN không được gán OWNER.');
      },
    });
    await controller.load();
    await controller.saveAccess(user('a'), {
      role: 'OWNER',
      propertyScope: ['p1'],
      isActive: true,
    });
    expect(controller.state.phase).toBe('ready');
    expect(controller.state.failure).toMatchObject({
      kind: 'rejected',
      code: 'E_RBAC_FORBIDDEN',
      reason: 'SYSADMIN không được gán OWNER.',
    });
  });

  it('hai lệnh ghi chồng nhau: lệnh thứ hai bị bỏ', async () => {
    let release: () => void = () => undefined;
    const updateAccess = vi.fn(async (id: string) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return user(id, { version: 5 });
    });
    const { controller } = setup({ updateAccess });
    await controller.load();
    const draftA = { role: 'MANAGER' as const, propertyScope: ['p1'], isActive: true };
    const first = controller.saveAccess(user('a'), draftA);
    await controller.saveAccess(user('b'), draftA);
    expect(updateAccess).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});

describe('xoá PIN', () => {
  it('thành công: dòng không còn PIN', async () => {
    const { controller } = setup();
    await controller.load();
    await controller.clearPin(user('a'));
    expect(controller.state.rows.find((r) => r.id === 'a')?.hasPin).toBe(false);
    expect(controller.state.notice).toBe('pinCleared');
  });
  it('máy chủ từ chối thì hiện nguyên mã và giữ hộp xác nhận', async () => {
    const { controller } = setup({
      deletePin: async () => {
        throw http(403, 'E_RBAC_FORBIDDEN', 'Không có quyền');
      },
    });
    await controller.load();
    controller.openPanel({ kind: 'pin', userId: 'a' });
    await controller.clearPin(user('a'));
    expect(controller.state.failure?.kind).toBe('rejected');
    expect(controller.state.panel).toEqual({ kind: 'pin', userId: 'a' });
    expect(controller.state.rows.find((r) => r.id === 'a')?.hasPin).toBe(true);
  });
});

it('sau dispose không còn thông báo nào', async () => {
  const { controller } = setup();
  const listener = vi.fn();
  controller.subscribe(listener);
  controller.dispose();
  await controller.load();
  expect(listener).not.toHaveBeenCalled();
});
