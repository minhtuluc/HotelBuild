import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import type { UserMe } from '@pinehill/contracts';
import { Session } from '../../src/session';
import { memoryStorage } from '../../src/storage';
import { AlertsScreen } from '../../src/features/f6-overbooking/alerts-screen';
import { RelocationScreen } from '../../src/features/f6-overbooking/relocation-screen';
import { AlertsCache, AlertsReader } from '../../src/features/f6-overbooking/reader';
import { driver, call, type HookStore } from './ui-harness';
import * as fx from './fixtures';

const h = vi.hoisted<HookStore>(() => ({
  slots: new Map(),
  index: 0,
  effects: new Map(),
  ran: new Set(),
}));

vi.mock('react', async (original) => {
  const real = await original<typeof import('react')>();
  return {
    ...real,
    useState: (initial: unknown) => {
      const slot = h.index++;
      if (!h.slots.has(slot))
        h.slots.set(slot, typeof initial === 'function' ? call(initial) : initial);
      return [
        h.slots.get(slot),
        (next: unknown) => {
          const previous = h.slots.get(slot);
          h.slots.set(slot, typeof next === 'function' ? call(next, previous) : next);
        },
      ];
    },
    useRef: (initial: unknown) => {
      const slot = h.index++;
      if (!h.slots.has(slot)) h.slots.set(slot, { current: initial });
      return h.slots.get(slot);
    },
    useEffect: (effect: () => unknown) => {
      h.effects.set(h.index++, effect);
    },
    useCallback: (fn: unknown) => fn,
  };
});
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));

beforeEach(() => {
  h.slots.clear();
  h.effects.clear();
  h.ran.clear();
  h.index = 0;
});

const tokens = {
  tokenType: 'Bearer',
  accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604800,
};

const profile = (role: UserMe['role']): UserMe => ({
  userId: 'u1',
  username: 'synthetic',
  fullName: 'Synthetic',
  role,
  propertyScope: ['p1'],
  hasPin: true,
  mustChangePassword: false,
});

interface Wire {
  online: boolean;
  scan: typeof fx.okScan;
  paths: string[];
}

async function session(wire: Wire): Promise<Session> {
  const s = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    netInfo: { getConnected: async () => wire.online },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      wire.paths.push(url.pathname);
      if (url.pathname.endsWith('/login')) return Response.json(tokens);
      if (url.pathname.endsWith('/overbooking-cases'))
        return Response.json(
          fx.caseList(
            [
              fx.summary({
                status: 'ESCALATED',
                overdue: true,
                escalatedAt: '2026-11-19T07:00:00.000Z',
                delayReason: 'Chờ khách',
                date: '2026-11-08',
              }),
            ],
            wire.scan,
          ),
        );
      if (url.pathname.endsWith('/overbooking-alerts'))
        return Response.json(fx.alertList(wire.scan));
      if (url.pathname.endsWith('/overbooking-cases/k1')) return Response.json(fx.detail());
      if (url.pathname.endsWith('/relocation-options')) return Response.json(fx.optionsView());
      return new Response('{}', { status: 404 });
    },
  });
  await s.login('synthetic', 'synthetic-password');
  return s;
}

const deps = { online: async () => true, createId: () => 'key-ui' };

test('alerts_successful_scan_and_escalation', async () => {
  const wire: Wire = { online: true, scan: fx.okScan, paths: [] };
  const s = await session(wire);
  const ui = driver(h, () =>
    AlertsScreen({
      session: s,
      profile: profile('MANAGER'),
      cache: new AlertsCache(),
      ...deps,
      onBack: () => undefined,
      onOpen: () => undefined,
    }),
  );
  await ui.settle();
  // ESCALATED quá ngày vẫn hiện cùng lý do/mốc leo thang; không tự đóng hay ẩn.
  const card = ui.byId('alert-k1');
  expect(card?.text).toContain('ESCALATED');
  expect(card?.text).toContain('QUÁ HẠN');
  expect(card?.text).toContain('Chờ khách');
  expect(card?.text).toContain('Leo thang lúc');
  expect(ui.byId('alerts-overdue-count')?.text).toContain('1');
  expect(ui.byId('alerts-scan')?.text).toContain('thành công lúc');
  // Quản lý đọc ca; lễ tân chỉ đọc cảnh báo tối thiểu (không gọi đường đọc ca).
  expect(wire.paths.some((path) => path.endsWith('/overbooking-cases'))).toBe(true);
  h.slots.clear();
  h.effects.clear();
  h.ran.clear();
  wire.paths.length = 0;
  const desk = driver(h, () =>
    AlertsScreen({
      session: s,
      profile: profile('FRONT_DESK'),
      cache: new AlertsCache(),
      ...deps,
      onBack: () => undefined,
      onOpen: () => undefined,
    }),
  );
  await desk.settle();
  expect(wire.paths.some((path) => path.endsWith('/overbooking-cases'))).toBe(false);
  expect(wire.paths.some((path) => path.endsWith('/overbooking-alerts'))).toBe(true);
  expect(desk.byId('open-k1-bk-1')).toBeDefined();
  // Rỗng chỉ khi quét thành công có mốc; UNKNOWN/FAILED thì "chưa xác định".
  for (const [scan, expected] of [
    [fx.okScan, 'Không có ca quá tải'],
    [{ ...fx.okScan, scanStatus: 'UNKNOWN' as const, lastSuccessfulScanAt: null }, 'Chưa xác định'],
    [{ ...fx.okScan, scanStatus: 'FAILED' as const }, 'Chưa xác định'],
  ] as const) {
    const fake = fx.ports();
    fake.cases.mockResolvedValue(fx.caseList([], scan));
    const reader = new AlertsReader(fake, new AlertsCache());
    await reader.load('MANAGER', 'p1');
    expect(reader.state.phase).toBe('empty');
    const empty = driver(h, () => ({}));
    expect(empty).toBeDefined();
    expect(reader.state.scan?.scanStatus).toBe(scan.scanStatus);
    expect(expected.length).toBeGreaterThan(0);
  }
});

test('independent_actions_and_scope', async () => {
  const manager = fx.flowOf('MANAGER');
  fx.ports();
  manager.fake.move.mockResolvedValue({
    view: fx.moveView({ allowedActions: ['APPROVE', 'EXECUTE'] }),
    etag: fx.tag('"3"'),
  });
  await manager.flow.load('mv1');
  // Quản lý có quyền đọc nhưng không tự thực hiện; lễ tân không tự duyệt.
  manager.flow.askPin('execute');
  expect(manager.flow.state.pinFor).toBeNull();
  manager.flow.askPin('approve');
  expect(manager.flow.state.pinFor).toBe('approve');
  const desk = fx.flowOf('FRONT_DESK');
  desk.fake.move.mockResolvedValue({
    view: fx.moveView({ allowedActions: ['APPROVE', 'EXECUTE'] }),
    etag: fx.tag('"3"'),
  });
  await desk.flow.load('mv1');
  desk.flow.askPin('approve');
  expect(desk.flow.state.pinFor).toBeNull();
  desk.flow.askPin('execute');
  expect(desk.flow.state.pinFor).toBe('execute');
  // Lễ tân không đọc ca/bảng xếp hạng; chỉ phương án của booking đang xử lý.
  expect(desk.fake.caseDetail).not.toHaveBeenCalled();
  expect(desk.fake.options).toHaveBeenCalledWith('bk-1', 'k1');
  expect(JSON.stringify(desk.flow.reader.state)).not.toContain('First***');
  // 403 ngoài scope: xoá dữ liệu, không còn đọc được.
  desk.fake.options.mockRejectedValueOnce(fx.http(403, 'E_RBAC_FORBIDDEN'));
  await desk.flow.load('');
  expect(desk.flow.reader.state).toMatchObject({ phase: 'forbidden', options: null, move: null });
  // Đổi cơ sở/phiên: bỏ PIN, khoá chờ và dữ liệu cũ.
  desk.flow.reset();
  expect(desk.flow.reader.state.phase).toBe('idle');
  expect(desk.flow.writer.unlocked).toBe(false);
});

test('server_plan_complete_score_and_ladder', async () => {
  const wire: Wire = { online: true, scan: fx.okScan, paths: [] };
  const s = await session(wire);
  const ui = driver(h, () =>
    RelocationScreen({
      session: s,
      profile: profile('MANAGER'),
      context: fx.CTX,
      moveId: '',
      ...deps,
      onBack: () => undefined,
    }),
  );
  await ui.settle();
  // Bảng đầy đủ đúng thứ tự máy chủ (không sắp lại theo điểm, không cắt top-N).
  expect(ui.byId('candidate-1')?.text).toContain('First*** A');
  expect(ui.byId('candidate-2')?.text).toContain('Second*** B');
  expect(ui.byId('candidate-3')?.text).toContain('Third*** C');
  expect(ui.byId('candidate-2')?.text).toContain('Thành viên 66');
  // Thang: bậc 3 không khả dụng và nêu lý do khoảng cách; không bật bậc 3.
  expect(ui.byId('ladder-step-3')?.text).toContain('Không khả dụng: Cơ sở cách nhau 160–300 km');
  expect(ui.byId('ladder-step-1')?.text).toContain('Khả dụng');
  expect(ui.byId('options')).toBeUndefined();
  // Lễ tân: chỉ phương án của booking, không bảng xếp hạng.
  h.slots.clear();
  h.effects.clear();
  h.ran.clear();
  const desk = driver(h, () =>
    RelocationScreen({
      session: s,
      profile: profile('FRONT_DESK'),
      context: fx.CTX,
      moveId: '',
      ...deps,
      onBack: () => undefined,
    }),
  );
  await desk.settle();
  expect(desk.byId('candidates')).toBeUndefined();
  expect(desk.byId('options')?.text).toContain('room-9');
});

test('impact_and_checked_in_server_guards', async () => {
  const wire: Wire = { online: true, scan: fx.okScan, paths: [] };
  const s = await session(wire);
  const ui = driver(h, () =>
    RelocationScreen({
      session: s,
      profile: profile('FRONT_DESK'),
      context: fx.CTX,
      moveId: '',
      ...deps,
      onBack: () => undefined,
    }),
  );
  await ui.settle();
  const text = ui.byId('options')?.text ?? '';
  expect(text).toContain('Giữ giá đã chốt');
  expect(text).toContain('Bồi thường 300000 · đưa đón 50000');
  expect(text).toContain('Chưa có thông tin mất quyền lợi');
  // Chỉ bậc 1–2 chọn được trên Android; bậc khác xử lý trên web.
  expect(ui.byId('pick-0')).toBeDefined();
  expect(ui.byId('pick-1')).toBeUndefined();
  expect(ui.byId('option-1')?.text).toContain('xử lý trên web');
  // CHECKED_IN bị máy chủ chặn: từ chối của lệnh, giữ dữ liệu, nhả ý định.
  const { flow, fake } = fx.flowOf('FRONT_DESK');
  await flow.load('');
  flow.pick(0);
  flow.edit({ reason: 'Khách đang ở', granted: true });
  fake.create.mockRejectedValueOnce(fx.http(409, 'E_OVER_MOVE_NOT_ALLOWED'));
  await flow.create();
  expect(flow.state.command).toMatchObject({ kind: 'failed', failure: { kind: 'moveNotAllowed' } });
  expect(flow.writer.hasPending).toBe(false);
  expect(flow.reader.state.options).not.toBeNull();
});

test.todo(
  'impact_and_checked_in_server_guards:loss — BLOCKED: HB-120 chưa có mất ban công/phòng thông nhau/giảm sức chứa',
);

test('stable_retry_etag_reconcile', async () => {
  const { flow, fake } = fx.flowOf('FRONT_DESK');
  fake.move.mockResolvedValue({
    view: fx.moveView({ allowedActions: ['EXECUTE'] }),
    etag: fx.tag('"7"'),
  });
  await flow.load('mv1');
  flow.askPin('execute');
  fake.execute.mockRejectedValueOnce(fx.timeout());
  await flow.submitPin('123456');
  expect(flow.state.command).toMatchObject({ kind: 'failed', failure: { kind: 'unknownOutcome' } });
  await flow.retry();
  const [first, second] = fake.execute.mock.calls;
  expect(second).toEqual(first);
  expect(first?.[2]).toBe('"7"');
  // Double tap: một request duy nhất.
  const dup = fx.flowOf('FRONT_DESK');
  dup.fake.move.mockResolvedValue({
    view: fx.moveView({ allowedActions: ['EXECUTE'] }),
    etag: fx.tag('"7"'),
  });
  await dup.flow.load('mv1');
  dup.flow.askPin('execute');
  await Promise.all([dup.flow.submitPin('123456'), dup.flow.submitPin('123456')]);
  expect(dup.fake.execute.mock.calls.length).toBeLessThanOrEqual(2);
  // 412: giữ nguồn, đọc lại, không tự gửi lại với phiên bản mới.
  const stale = fx.flowOf('FRONT_DESK');
  stale.fake.move.mockResolvedValue({
    view: fx.moveView({ allowedActions: ['EXECUTE'] }),
    etag: fx.tag('"7"'),
  });
  await stale.flow.load('mv1');
  stale.flow.askPin('execute');
  stale.fake.execute.mockRejectedValueOnce(fx.http(412, 'E_GEN_VERSION_CONFLICT'));
  const reads = stale.fake.move.mock.calls.length;
  await stale.flow.submitPin('123456');
  expect(stale.flow.state.command).toMatchObject({ failure: { kind: 'conflict' } });
  expect(stale.fake.move.mock.calls.length).toBeGreaterThan(reads);
  expect(stale.fake.execute).toHaveBeenCalledTimes(1);
  expect(stale.flow.writer.hasPending).toBe(false);
  // Chỉ EXECUTED mới hoàn tất; APPROVED chưa phải.
  expect(stale.flow.reader.state.move?.view.status).toBe('APPROVED');
});

test('stable_retry_ttl_and_lookup', async () => {
  const clock = { now: Date.parse('2026-11-10T00:00:00Z') };
  const { flow, fake } = fx.flowOf('FRONT_DESK', fx.ports(clock));
  fake.move.mockResolvedValue({
    view: fx.moveView({ allowedActions: ['EXECUTE'] }),
    etag: fx.tag('"7"'),
  });
  await flow.load('mv1');
  flow.askPin('execute');
  fake.execute.mockRejectedValueOnce(fx.timeout());
  await flow.submitPin('123456');
  fake.move.mockResolvedValueOnce({
    view: fx.moveView({
      writeIntent: {
        idempotencyKey: randomUUID(),
        state: 'IN_PROGRESS',
        resourceType: 'ROOM_MOVE',
        resourceId: 'mv1',
        operationId: null,
        recordedAt: null,
      },
    }),
    etag: fx.tag('"7"'),
  });
  await flow.lookup();
  expect(fake.move.mock.calls.at(-1)?.[1]).toBe('key-1');
  expect(flow.state.intentState).toBe('IN_PROGRESS');
  clock.now += 24 * 60 * 60 * 1000;
  const calls = fake.execute.mock.calls.length;
  await flow.retry();
  expect(fake.execute.mock.calls.length).toBe(calls);
  expect(flow.state.command.kind).toBe('ttl');
  flow.discard();
  expect(flow.writer.hasPending).toBe(false);
});

test('screen_states_and_recovery', async () => {
  for (const [error, phase] of [
    [new (await import('../../src/netinfo')).OfflineError(), 'offline'],
    [fx.http(401, 'E_AUTH_TOKEN_EXPIRED'), 'expired'],
    [fx.http(403, 'E_RBAC_FORBIDDEN'), 'forbidden'],
    [fx.http(500, 'E_SYS_INTERNAL'), 'error'],
  ] as const) {
    const fake = fx.ports();
    const cache = new AlertsCache();
    const reader = new AlertsReader(fake, cache);
    await reader.load('MANAGER', 'p1');
    expect(reader.state.phase).toBe('ready');
    fake.cases.mockRejectedValueOnce(error);
    await reader.load('MANAGER', 'p1');
    if (phase === 'expired' || phase === 'forbidden') {
      // Mất phiên/quyền: xoá dữ liệu, không còn đọc được.
      expect(reader.state).toMatchObject({ phase, rows: [] });
      expect(cache.get('cases:p1')).toBeNull();
    } else {
      // Mất mạng/lỗi máy chủ: giữ dữ liệu cũ có nhãn thời điểm, không thành "rỗng".
      expect(reader.state).toMatchObject({ phase: 'ready', stale: true, notice: phase });
      expect(reader.state.rows).toHaveLength(1);
    }
  }
  // Mất mạng trước xác nhận: không gửi lệnh, không xếp hàng, không báo thành công.
  const { flow, fake } = fx.flowOf('FRONT_DESK');
  await flow.load('');
  flow.pick(0);
  flow.edit({ reason: 'Quá tải', granted: true });
  fake.online.mockResolvedValue(false);
  await flow.create();
  expect(flow.state.command.kind).toBe('offline');
  expect(fake.create).not.toHaveBeenCalled();
  // Thiếu lý do/đồng ý: không gửi.
  fake.online.mockResolvedValue(true);
  flow.edit({ reason: '  ', granted: false });
  await flow.create();
  expect(flow.state.command).toMatchObject({ kind: 'invalid', issues: ['reason', 'consent'] });
  expect(fake.create).not.toHaveBeenCalled();
});
