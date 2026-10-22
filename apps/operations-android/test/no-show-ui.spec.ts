import { isValidElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BookingSummary } from '@pinehill/contracts';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';
import { sendNoShow } from '../src/no-show/ports';
import { CheckInDetail } from '../src/arrivals/detail';
import { CheckInWriter } from '../src/arrivals/writer';
import { NoShowScreen } from '../src/no-show/screen';
import { NoShowWriter } from '../src/no-show/writer';

/**
 * Harness tối thiểu như `arrivals-ui.spec.ts` (không có renderer thật trong repo): hook thay bằng kho theo
 * thứ tự gọi, thành phần hàm bung đệ quy thành cây phần tử máy chủ. Writer/Session/ApiClient là mã thật;
 * chỉ `fetch`, đồng hồ và nguyên thủy giao diện native là biên được thay.
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

const booking: BookingSummary = {
  id: 'b1',
  code: 'PH-261022-B1',
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
  paidAmount: 900_000,
  refundedAmount: 0,
  balanceDue: 2_100_000,
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
};

interface Wire {
  online: boolean;
  noShow: () => Response;
  posts: Array<{ key: string | null; body: unknown }>;
}

const marked = () =>
  Response.json(
    {
      bookingId: 'b1',
      status: 'NO_SHOW',
      markedAt: '2026-10-22T17:00:00.000Z',
      penaltyAmount: 1_200_000,
      refundRequestId: null,
    },
    { status: 201 },
  );

const events: string[] = [];

async function mount(wire: Wire) {
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    netInfo: { getConnected: async () => wire.online },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/login')) return Response.json(tokens);
      wire.posts.push({
        key: new Headers(init?.headers).get('idempotency-key'),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      return wire.noShow();
    },
  });
  await session.login('synthetic', 'Synthetic-password');
  let n = 0;
  const writer = new NoShowWriter({
    online: async () => wire.online,
    createId: () => `key-${++n}`,
    send: (body, key) => sendNoShow(session, body, key),
  });
  element = () =>
    NoShowScreen({
      booking,
      writer,
      now: () => Date.now(),
      onChanged: () => {
        events.push('changed');
      },
      onClose: () => {
        events.push('closed');
      },
    });
  await settle();
}

beforeEach(() => {
  h.slots.clear();
  h.effects.clear();
  h.ran.clear();
  events.length = 0;
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  // 16:40 giờ VN: còn 7h19m tới 23:59.
  vi.setSystemTime(new Date('2026-10-22T09:40:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

test('shows the countdown to 23:59, the policy consequence (no invented amount) and a prefilled reason', async () => {
  await mount({ online: true, noShow: marked, posts: [] });
  expect(byId('no-show-countdown')?.text).toContain('07:19:00');
  expect(textOf()).toContain('PH-261022-B1');
  expect(byId('no-show-policy')?.text).toContain('bậc cuối');
  expect(byId('no-show-policy')?.text).toContain('chưa có API xem trước');
  expect(byId('no-show-reason')?.props.value).toBe('Khách không đến nhận phòng');
  expect(byId('no-show-submit')?.props.accessibilityState).toMatchObject({ disabled: false });
});

test('the countdown ticks and flips to "reached" at 23:59:00', async () => {
  await mount({ online: true, noShow: marked, posts: [] });
  vi.setSystemTime(new Date('2026-10-22T16:58:58.000Z'));
  vi.advanceTimersByTime(1000);
  render();
  expect(byId('no-show-countdown')?.text).toContain('00:00:01');
  vi.advanceTimersByTime(1000);
  render();
  expect(byId('no-show-countdown')?.text).toContain('Đã tới 23:59');
});

test('one tap on confirm sends the prefilled reason with a key and shows what the server charged', async () => {
  const wire: Wire = { online: true, noShow: marked, posts: [] };
  await mount(wire);
  press('no-show-submit');
  await settle();
  expect(wire.posts).toEqual([
    { key: 'key-1', body: { bookingId: 'b1', reason: 'Khách không đến nhận phòng' } },
  ]);
  expect(byId('no-show-done')).toBeDefined();
  expect(textOf()).toContain('1.200.000');
  expect(events).toEqual(['changed']);
});

test('a blank reason is blocked locally with an alert and sends nothing', async () => {
  const wire: Wire = { online: true, noShow: marked, posts: [] };
  await mount(wire);
  const change = byId('no-show-reason')?.props.onChangeText;
  call(change, '   ');
  await settle();
  press('no-show-submit');
  await settle();
  expect(byId('no-show-reason-issue')?.props.accessibilityRole).toBe('alert');
  expect(wire.posts).toEqual([]);
});

test('before 23:59 the server refusal is shown verbatim with its code; the client does not pre-block', async () => {
  const wire: Wire = {
    online: true,
    posts: [],
    noShow: () =>
      Response.json(
        {
          code: 'E_BOOK_INVALID_STATE',
          message: 'Chưa tới 23:59 ngày nhận phòng nên chưa được ghi nhận không đến.',
          traceId: 't',
          timestamp: '2026-10-22T09:40:00Z',
          path: '/front-office/no-show',
        },
        { status: 409 },
      ),
  };
  await mount(wire);
  press('no-show-submit');
  await settle();
  expect(textOf()).toContain('E_BOOK_INVALID_STATE');
  expect(textOf()).toContain('Chưa tới 23:59 ngày nhận phòng');
  expect(byId('no-show-done')).toBeUndefined();
  expect(events).toEqual([]);
});

test('offline sends nothing and says so', async () => {
  const wire: Wire = { online: true, noShow: marked, posts: [] };
  await mount(wire);
  wire.online = false;
  press('no-show-submit');
  await settle();
  expect(wire.posts).toEqual([]);
  expect(textOf()).toContain('Cần kết nối mạng để ghi no-show');
});

test('an unknown outcome offers reconcile (close + reload) and the retry reuses the key', async () => {
  let calls = 0;
  const wire: Wire = {
    online: true,
    posts: [],
    noShow: () => (++calls === 1 ? new Response('bad gateway', { status: 502 }) : marked()),
  };
  await mount(wire);
  press('no-show-submit');
  await settle();
  expect(textOf()).toContain('Chưa xác định kết quả');
  press('no-show-submit');
  await settle();
  expect(wire.posts.map((post) => post.key)).toEqual(['key-1', 'key-1']);
  expect(byId('no-show-done')).toBeDefined();
});

test('back and the done screen close without extra requests', async () => {
  const wire: Wire = { online: true, noShow: marked, posts: [] };
  await mount(wire);
  press('no-show-back');
  expect(events).toEqual(['closed']);
  press('no-show-submit');
  await settle();
  press('no-show-close');
  expect(events).toEqual(['closed', 'changed', 'closed']);
});

test('SCR-58 offers "Ghi no-show" only when the parent wires it, and hands over the booking', () => {
  const writer = new CheckInWriter({
    online: async () => true,
    createId: () => 'k',
    send: async () => {
      throw new Error('not used');
    },
  });
  const opened: string[] = [];
  const props = {
    booking,
    rooms: [],
    writer,
    onChanged: () => undefined,
    onClose: () => undefined,
  };
  element = () => CheckInDetail(props);
  render();
  expect(byId('check-in-no-show')).toBeUndefined();
  h.index = 0;
  h.slots.clear();
  element = () =>
    CheckInDetail({
      ...props,
      onNoShow: (target) => {
        opened.push(target.id);
      },
    });
  render();
  expect(byId('check-in-no-show')?.props.accessibilityLabel).toBe('Ghi no-show');
  press('check-in-no-show');
  expect(opened).toEqual(['b1']);
});
