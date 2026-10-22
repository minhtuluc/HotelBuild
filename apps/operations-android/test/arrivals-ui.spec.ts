import { isValidElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';
import { sendCheckIn } from '../src/arrivals/ports';
import { ArrivalsCache } from '../src/arrivals/reader';
import { ArrivalsScreen } from '../src/arrivals/screen';
import { CheckInWriter, type CheckInPorts } from '../src/arrivals/writer';

/**
 * Harness tối thiểu (không có renderer thật trong repo): hook được thay bằng kho theo thứ tự gọi, thành phần
 * hàm được bung đệ quy thành cây phần tử máy chủ ('View', 'Pressable'...). Reader/Writer/Session/ApiClient là
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
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
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
const booking = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  code: `PH-261022-${id.toUpperCase()}`,
  seq: 1,
  status: 'CONFIRMED',
  guestId: 'g1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanId: 'rp1',
  channelId: 'ch1',
  checkIn: '2026-10-22',
  checkOut: '2026-10-24',
  nights: 2,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 3_000_000,
  depositPercent: 30,
  depositAmount: 900_000,
  paidAmount: 3_000_000,
  refundedAmount: 0,
  balanceDue: 0,
  penaltyAmount: 0,
  currency: 'VND',
  rescheduleCount: 0,
  holdExpiresAt: null,
  oversold: false,
  priceLocked: false,
  duplicateSuspected: false,
  channelPolicyCode: null,
  note: null,
  createdBy: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const room = (id: string, code: string) => ({
  id,
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code,
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: null,
  version: 0,
});
const meta = { limit: 100, total: 2, hasMore: false, nextCursor: null };

interface Wire {
  online: boolean;
  checkIn: () => Response;
  posts: Array<{ key: string | null; body: unknown }>;
}

async function mount(wire: Wire, bookings = [booking('b1', { balanceDue: 0 })]) {
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    netInfo: { getConnected: async () => wire.online },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/login')) return Response.json(tokens);
      if (url.pathname.endsWith('/bookings')) return Response.json({ data: bookings, meta });
      if (url.pathname.endsWith('/rooms'))
        return Response.json({
          data: [room('r2', 'CS01-102'), room('r1', 'CS01-101')],
          meta,
        });
      wire.posts.push({
        key: new Headers(init?.headers).get('idempotency-key'),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      return wire.checkIn();
    },
  });
  await session.login('synthetic', 'Synthetic-password');
  session.selectProperty('p1');
  let n = 0;
  const ports: CheckInPorts = {
    online: async () => wire.online,
    createId: () => `key-${++n}`,
    send: (body, key) => sendCheckIn(session, body, key),
  };
  const cache = new ArrivalsCache();
  const createWriter = () => new CheckInWriter(ports);
  element = () => ArrivalsScreen({ session, cache, createWriter, onBack: () => undefined });
  await settle();
}

const checkedIn = () =>
  Response.json(
    {
      bookingId: 'b1',
      status: 'CHECKED_IN',
      roomIds: ['r1'],
      checkedInAt: '2026-10-22T07:00:00.000Z',
      earlyCheckInFee: 0,
    },
    { status: 201 },
  );

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

test('opening a card then confirming is two taps with the suggested room preselected', async () => {
  const wire: Wire = { online: true, checkIn: checkedIn, posts: [] };
  await mount(wire);
  expect(textOf()).toContain('PH-261022-B1');
  expect(byId('arrivals-synced')).toBeDefined();

  press('arrival-b1'); // tap 1
  await settle();
  expect(byId('check-in-room-r1')?.props.accessibilityState).toMatchObject({ checked: true });
  expect(byId('check-in-room-r2')?.props.accessibilityState).toMatchObject({ checked: false });

  press('check-in-submit'); // tap 2
  await settle();
  expect(wire.posts).toEqual([
    {
      key: 'key-1',
      body: { bookingId: 'b1', actualRoomIds: ['r1'], earlyCheckIn: false },
    },
  ]);
  expect(byId('check-in-done')).toBeDefined();
  expect(textOf()).toContain('CS01-101');
});

test('deselecting the room blocks the request locally with an accessible alert', async () => {
  const wire: Wire = { online: true, checkIn: checkedIn, posts: [] };
  await mount(wire);
  press('arrival-b1');
  await settle();
  press('check-in-room-r1');
  await settle();
  press('check-in-submit');
  await settle();
  expect(byId('check-in-room-issue')?.props.accessibilityRole).toBe('alert');
  expect(wire.posts).toEqual([]);
});

test('offline confirm sends nothing and says so; the form stays', async () => {
  const wire: Wire = { online: true, checkIn: checkedIn, posts: [] };
  await mount(wire);
  press('arrival-b1');
  await settle();
  wire.online = false;
  press('check-in-submit');
  await settle();
  expect(wire.posts).toEqual([]);
  expect(textOf()).toContain('Cần kết nối mạng để xác nhận nhận phòng');
  expect(byId('check-in-done')).toBeUndefined();
  expect(byId('check-in-submit')).toBeDefined();
});

test('a server refusal is shown with its code and reason; the debt gate is not computed on the client', async () => {
  const wire: Wire = {
    online: true,
    posts: [],
    checkIn: () =>
      Response.json(
        {
          code: 'E_FO_CHECKIN_NOT_ALLOWED',
          message: 'Còn nợ vượt ngưỡng; cần quản lý hoặc chủ sở hữu duyệt cho nợ.',
          traceId: 't',
          timestamp: '2026-10-22T07:00:00Z',
          path: '/front-office/check-in',
        },
        { status: 409 },
      ),
  };
  await mount(wire, [booking('b1', { balanceDue: 2_100_000, paidAmount: 900_000 })]);
  press('arrival-b1');
  await settle();
  // The submit button is enabled although the booking owes money: the server decides (ADR-018).
  expect(byId('check-in-submit')?.props.accessibilityState).toMatchObject({ disabled: false });
  press('check-in-submit');
  await settle();
  expect(textOf()).toContain('E_FO_CHECKIN_NOT_ALLOWED');
  expect(textOf()).toContain('Còn nợ vượt ngưỡng');
});

test('an unknown outcome offers reconcile and the retry reuses the same key', async () => {
  let calls = 0;
  const wire: Wire = {
    online: true,
    posts: [],
    checkIn: () => (++calls === 1 ? new Response('bad gateway', { status: 502 }) : checkedIn()),
  };
  await mount(wire);
  press('arrival-b1');
  await settle();
  press('check-in-submit');
  await settle();
  expect(byId('check-in-reconcile')).toBeDefined();
  expect(textOf()).toContain('Chưa xác định kết quả');
  press('check-in-reconcile');
  await settle();
  expect(byId('arrivals-list')).toBeDefined();
  expect(byId('check-in-submit')).toBeUndefined();
  press('arrival-b1');
  await settle();
  press('check-in-submit');
  await settle();
  expect(wire.posts.map((post) => post.key)).toEqual(['key-1', 'key-1']);
  expect(byId('check-in-done')).toBeDefined();
});

test('the QR button never blocks the flow when no scanner exists', async () => {
  const wire: Wire = { online: true, checkIn: checkedIn, posts: [] };
  await mount(wire);
  press('arrivals-scan');
  await settle();
  expect(byId('arrivals-scan-notice')).toBeDefined();
  expect(textOf()).toContain('Nhập mã booking');
  expect(byId('arrival-b1')).toBeDefined();
  expect(byId('arrivals-filter')).toBeDefined();
});
