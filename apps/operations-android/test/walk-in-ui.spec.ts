import { isValidElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';
import { WalkInFlow } from '../src/walk-in/flow';
import { walkInApiPorts } from '../src/walk-in/ports';
import { WalkInScreen } from '../src/walk-in/screen';
import { payment, result, roomType } from './walk-in-fixtures';

/**
 * Harness tối thiểu (không có renderer thật trong repo): hook được thay bằng kho theo thứ tự gọi, thành phần
 * hàm được bung đệ quy thành cây phần tử máy chủ ('View', 'Pressable'...). Flow/Session/ApiClient là
 * mã thật; chỉ `fetch`, đồng hồ và các nguyên thủy giao diện native là biên được thay.
 */
const h = vi.hoisted(() => ({
  slots: new Map<number, unknown>(),
  index: 0,
  effects: new Map<number, () => unknown>(),
  ran: new Set<number>(),
}));

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== 'function') throw new TypeError('not callable');
  return Reflect.apply(fn, undefined, args);
}

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
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));

interface Node {
  type: string;
  props: Record<string, unknown>;
  children: Node[];
  text: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function host(type: string, props: Record<string, unknown>): Node[] {
  const rendered =
    type === 'FlatList' && Array.isArray(props.data)
      ? props.data.flatMap((item: unknown) => expand(call(props.renderItem, { item })))
      : expand(props.children);
  return [{ type, props, children: rendered, text: rendered.map((child) => child.text).join('') }];
}

function expand(node: unknown): Node[] {
  if (typeof node === 'string' || typeof node === 'number')
    return [{ type: '#text', props: {}, children: [], text: String(node) }];
  if (Array.isArray(node)) return node.flatMap((child: unknown) => expand(child));
  if (!isRecord(node) || !isValidElement(node)) return [];
  const props = isRecord(node.props) ? node.props : {};
  if (typeof node.type === 'function') return expand(call(node.type, props));
  if (typeof node.type === 'symbol') return expand(props.children);
  return host(String(node.type), props);
}

function walk(nodes: Node[]): Node[] {
  return nodes.flatMap((n) => [n, ...walk(n.children)]);
}

let tree: Node[] = [];
let element: () => unknown;
function render(): void {
  h.index = 0;
  tree = expand(element());
}
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
/** Chạy các effect mới (chỉ một lần mỗi vị trí hook), rồi vẽ lại cho tới khi ổn định. */
async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    render();
    for (const [slot, effect] of h.effects) {
      if (h.ran.has(slot)) continue;
      h.ran.add(slot);
      call(effect);
    }
    await flush();
  }
  render();
}
const byId = (id: string): Node | undefined => walk(tree).find((n) => n.props.testID === id);
const textOf = (): string => tree.map((n) => n.text).join(' | ');
function press(id: string): void {
  const node = byId(id);
  if (!node) throw new Error(`no node ${id}; tree: ${textOf()}`);
  call(node.props.onPress);
}

const tokens = {
  tokenType: 'Bearer',
  accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604800,
};
const meta = { limit: 100, total: 1, hasMore: false, nextCursor: null };

function type(id: string, value: string): void {
  const node = byId(id);
  if (!node) throw new Error(`no node ${id}; tree: ${textOf()}`);
  call(node.props.onChangeText, value);
}

interface Wire {
  online: boolean;
  createBooking: () => Response;
  requests: Array<{ path: string; method: string; key: string | null; body: unknown }>;
}

function routes(wire: Wire): Record<string, () => Response> {
  return {
    '/auth/login': () => Response.json(tokens),
    '/room-types': () => Response.json({ data: [roomType], meta }),
    '/walk-in': () => wire.createBooking(),
    '/auth/pin/verify': () =>
      Response.json({
        pinToken: 'pin-token-0123456789',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    '/payments': () => Response.json(payment, { status: 201 }),
  };
}

async function mount(wire: Wire, property: string | null = 'p1'): Promise<void> {
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    netInfo: { getConnected: async () => wire.online },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname.replace('/api/v1', '');
      wire.requests.push({
        path,
        method: init?.method ?? 'GET',
        key: new Headers(init?.headers).get('idempotency-key'),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      const route = routes(wire)[path];
      return route === undefined ? new Response('{}', { status: 404 }) : route();
    },
  });
  await session.login('synthetic', 'Synthetic-password');
  if (property !== null) session.selectProperty(property);
  let n = 0;
  const createFlow = () =>
    new WalkInFlow({
      ...walkInApiPorts(session),
      online: async () => wire.online,
      now: () => Date.now(),
      createId: () => `key-${++n}`,
    });
  element = () => WalkInScreen({ session, createFlow, onBack: () => undefined });
  await settle();
}

const created = () => Response.json(result(), { status: 201 });
const wireOf = (over: Partial<Wire> = {}): Wire => ({
  online: true,
  createBooking: created,
  requests: [],
  ...over,
});
const posts = (wire: Wire, path: string) => wire.requests.filter((r) => r.path === path);

async function toReview(): Promise<void> {
  press('walk-in-room-type-rt1');
  press('walk-in-next');
  await settle();
  type('walk-in-name', 'Nguyễn Văn A');
  type('walk-in-phone', '0912345678');
  press('walk-in-next');
  await settle();
}

beforeEach(() => {
  h.slots.clear();
  h.effects.clear();
  h.ran.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-22T02:41:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

test('five steps end to end: create, PIN, deposit; server numbers on screen; PIN only in verify and the pinToken in the payment', async () => {
  const wire = wireOf();
  await mount(wire);
  expect(byId('walk-in-step')?.text).toContain('Bước 1/5');
  await settle();
  await toReview();
  expect(byId('walk-in-step')?.text).toContain('Bước 3/5');
  expect(byId('walk-in-review')?.text).toContain('DLX');
  press('walk-in-create');
  await settle();
  expect(byId('walk-in-step')?.text).toContain('Bước 4/5');
  expect(byId('walk-in-deposit-amount')?.text).toContain('907.000');
  type('walk-in-pin', '482913');
  await settle();
  press('walk-in-verify-pin');
  await settle();
  expect(byId('walk-in-pin-state')?.text).toContain('PIN hợp lệ');
  expect(byId('walk-in-pin')).toBeUndefined();
  press('walk-in-pay');
  await settle();
  expect(byId('walk-in-step')?.text).toContain('Bước 5/5');
  expect(byId('walk-in-done')?.text).toContain('Đã ghi nhận cọc cho PH-261022-W1');
  expect(posts(wire, '/walk-in')).toEqual([
    {
      path: '/walk-in',
      method: 'POST',
      key: 'key-1',
      body: {
        propertyId: 'p1',
        roomTypeId: 'rt1',
        ratePlanCode: 'FLEX7',
        checkIn: '2026-10-22',
        checkOut: '2026-10-23',
        adults: 2,
        children: 0,
        roomCount: 1,
        guest: { fullName: 'Nguyễn Văn A', phone: '0912345678' },
      },
    },
  ]);
  expect(posts(wire, '/auth/pin/verify')[0]?.body).toEqual({ pin: '482913', bookingId: 'b1' });
  expect(posts(wire, '/payments')[0]).toMatchObject({
    key: 'key-2',
    body: {
      bookingId: 'b1',
      type: 'DEPOSIT',
      method: 'CASH',
      amount: 907_000,
      pinToken: 'pin-token-0123456789',
    },
  });
  const sent = JSON.stringify(wire.requests.filter((r) => r.path !== '/auth/pin/verify'));
  expect(sent).not.toContain('482913');
});

test('step 1 blocks locally with an alert when no room type is chosen; nothing is sent', async () => {
  const wire = wireOf();
  await mount(wire);
  press('walk-in-next');
  await settle();
  expect(byId('walk-in-stay-issue')?.props.accessibilityRole).toBe('alert');
  expect(byId('walk-in-step')?.text).toContain('Bước 1/5');
  expect(posts(wire, '/walk-in')).toEqual([]);
});

test('offline create sends nothing and says so', async () => {
  const wire = wireOf();
  await mount(wire);
  await toReview();
  wire.online = false;
  press('walk-in-create');
  await settle();
  expect(posts(wire, '/walk-in')).toEqual([]);
  expect(byId('walk-in-failure')?.text).toContain('Cần kết nối mạng');
  expect(byId('walk-in-step')?.text).toContain('Bước 3/5');
});

test('a server refusal is shown with code and reason', async () => {
  const wire = wireOf({
    createBooking: () =>
      Response.json(
        {
          code: 'E_INV_NO_AVAILABILITY',
          message: 'Hết phòng đêm 22/10.',
          traceId: 't',
          timestamp: '2026-10-22T00:00:00Z',
          path: '/walk-in',
        },
        { status: 409 },
      ),
  });
  await mount(wire);
  await toReview();
  press('walk-in-create');
  await settle();
  expect(byId('walk-in-failure')?.text).toContain('E_INV_NO_AVAILABILITY');
  expect(byId('walk-in-failure')?.text).toContain('Hết phòng đêm 22/10.');
});

test('a lost response keeps the key: retry replays the same Idempotency-Key', async () => {
  let calls = 0;
  const wire = wireOf({
    createBooking: () => (++calls === 1 ? new Response('bad gateway', { status: 502 }) : created()),
  });
  await mount(wire);
  await toReview();
  press('walk-in-create');
  await settle();
  expect(byId('walk-in-failure')?.text).toContain('Chưa xác định kết quả');
  press('walk-in-create');
  await settle();
  expect(posts(wire, '/walk-in').map((r) => r.key)).toEqual(['key-1', 'key-1']);
  expect(byId('walk-in-step')?.text).toContain('Bước 4/5');
});

test('deposit can be left for later: the booking exists and no payment is sent', async () => {
  const wire = wireOf();
  await mount(wire);
  await toReview();
  press('walk-in-create');
  await settle();
  press('walk-in-skip-deposit');
  await settle();
  expect(byId('walk-in-done')?.text).toContain('chưa thu cọc');
  expect(posts(wire, '/payments')).toEqual([]);
});

test('without a selected property the screen says so and offers no flow', async () => {
  const wire = wireOf();
  await mount(wire, null);
  expect(byId('walk-in-no-property')).toBeDefined();
  expect(byId('walk-in-next')).toBeUndefined();
  expect(posts(wire, '/room-types')).toEqual([]);
});
