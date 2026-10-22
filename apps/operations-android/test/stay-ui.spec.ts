import { isValidElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CollectScreen } from '../src/stay/collect';
import { checkOutPorts, collectPorts, unlockPin } from '../src/stay/ports';
import { DeparturesScreen } from '../src/stay/screen';
import { PinnedWriter } from '../src/stay/writer';
import { PIN_TOKEN, apiError, done, loggedInSession, stay, wire, type Wire } from './stay-wire';

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
    useMemo: (fn: unknown) => call(fn),
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
/** Số hook của thành phần gốc: các thành phần con (bung ra sau đó) dùng các ô sau con số này. */
let ownHooks = 0;
function render(): void {
  h.index = 0;
  const out = element();
  ownHooks = h.index;
  tree = expand(out);
}
/** Khi đổi màn con (checkout → collect) bỏ trạng thái hook của màn cũ để màn mới khởi tạo sạch. */
function dropChildren(): void {
  for (const slot of [...h.slots.keys()]) if (slot >= ownHooks) h.slots.delete(slot);
  for (const slot of [...h.effects.keys()]) if (slot >= ownHooks) h.effects.delete(slot);
  for (const slot of [...h.ran]) if (slot >= ownHooks) h.ran.delete(slot);
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

async function mount(
  w: Wire,
  screen: 'departures' | 'collect',
  booking = stay('b1', { balanceDue: 150_000 }),
) {
  const session = await loggedInSession(w);
  let n = 0;
  const shared = {
    online: async () => w.online,
    createId: () => `key-${++n}`,
    verifyPin: (pin: string, bookingId: string) => unlockPin(session, pin, bookingId),
  };
  const createCheckOutWriter = () => new PinnedWriter(checkOutPorts(session, shared));
  const createCollectWriter = () => new PinnedWriter(collectPorts(session, shared));
  element =
    screen === 'departures'
      ? () =>
          DeparturesScreen({
            session,
            createCheckOutWriter,
            createCollectWriter,
            onBack: () => undefined,
          })
      : () =>
          CollectScreen({
            session,
            booking,
            createWriter: createCollectWriter,
            onClose: () => undefined,
          });
  await settle();
}

async function unlock(pin = '123456'): Promise<void> {
  call(byId('pin-input')?.props.onChangeText, pin);
  await settle();
  press('pin-unlock');
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

test('SCR-60 lists stays due today and overdue ones, never future departures', async () => {
  await mount(wire(), 'departures');
  expect(byId('departure-b1')).toBeDefined();
  expect(byId('departure-late')).toBeDefined();
  expect(byId('departure-later')).toBeUndefined();
  expect(textOf()).toContain('Quá hạn trả phòng');
  expect(byId('departures-synced')).toBeDefined();
});

test('check-out: open card, unlock PIN, confirm — PIN token travels once and the fee shown is the server number', async () => {
  const w = wire();
  await mount(w, 'departures');
  press('departure-b1');
  await settle();
  expect(byId('check-out-submit')?.props.accessibilityState).toMatchObject({ disabled: true });
  await unlock();
  expect(w.verifies).toEqual([{ pin: '123456', bookingId: 'b1' }]);
  expect(byId('pin-unlocked')).toBeDefined();
  expect(byId('check-out-submit')?.props.accessibilityState).toMatchObject({ disabled: false });
  press('check-out-submit');
  await settle();
  expect(w.posts).toEqual([
    {
      path: '/front-office/check-out',
      key: 'key-1',
      body: { bookingId: 'b1', lateCheckOut: false, earlyCheckOut: false, pinToken: PIN_TOKEN },
    },
  ]);
  expect(textOf()).toContain('Máy chủ đã xác nhận trả phòng PH-261020-B1');
  expect(byId('check-out-fee')?.text).toContain('150.000');
});

test('an early departure is prefilled from the stay dates and the server still decides', async () => {
  const w = wire({ bookings: [stay('b1', { checkOut: '2026-10-22' })] });
  await mount(w, 'departures');
  press('departure-b1');
  await settle();
  expect(byId('check-out-early')?.props.accessibilityState).toMatchObject({ checked: false });
});

test('unsettled balance: server refuses, the screen reads the server balance and offers collection', async () => {
  const w = wire({
    checkOut: () =>
      apiError(422, 'E_PAY_AMOUNT_MISMATCH', 'Còn số dư phải thu trước khi trả phòng.'),
  });
  await mount(w, 'departures');
  press('departure-b1');
  await settle();
  await unlock();
  press('check-out-submit');
  await settle();
  expect(textOf()).toContain('E_PAY_AMOUNT_MISMATCH');
  expect(byId('check-out-unsettled')).toBeDefined();
  expect(byId('check-out-unsettled-balance')?.text).toContain('150.000');
  expect(byId('check-out-collect')).toBeDefined();
  // the PIN is spent after a definite refusal
  expect(byId('check-out-submit')?.props.accessibilityState).toMatchObject({ disabled: true });
  expect(byId('pin-input')).toBeDefined();
  press('check-out-collect');
  dropChildren();
  await settle();
  expect(byId('collect-submit')).toBeDefined();
});

test('wrong and locked PIN never reach the financial command', async () => {
  const w = wire({ verify: () => apiError(401, 'E_AUTH_PIN_REQUIRED', 'PIN sai') });
  await mount(w, 'departures');
  press('departure-b1');
  await settle();
  await unlock();
  expect(byId('pin-message')?.text).toContain('PIN không đúng');
  w.verify = () => apiError(403, 'E_AUTH_PIN_LOCKED', 'khoá', { retryAfterSeconds: 900 });
  await unlock();
  expect(byId('pin-message')?.text).toContain('15 phút');
  await unlock('12');
  expect(byId('pin-message')?.text).toContain('đúng 6 chữ số');
  // one request per attempt: a 401 on pin/verify must never be refreshed and replayed (lockout counter)
  expect(w.verifies).toHaveLength(2);
  expect(w.posts).toEqual([]);
});

test('offline at confirm: nothing is sent or queued and the PIN stays usable', async () => {
  const w = wire();
  await mount(w, 'departures');
  press('departure-b1');
  await settle();
  await unlock();
  w.online = false;
  press('check-out-submit');
  await settle();
  expect(w.posts).toEqual([]);
  expect(textOf()).toContain('Cần kết nối mạng cho thao tác này');
  expect(byId('check-out-done')).toBeUndefined();
  w.online = true;
  press('check-out-submit');
  await settle();
  expect(byId('check-out-done')).toBeDefined();
});

test('a lost response is unknown: retry replays the same key and token, reconcile returns to the list', async () => {
  const w = wire({
    checkOut: (n) => (n === 1 ? new Response('bad gateway', { status: 502 }) : done()),
  });
  await mount(w, 'departures');
  press('departure-b1');
  await settle();
  await unlock();
  press('check-out-submit');
  await settle();
  expect(textOf()).toContain('Chưa xác định kết quả');
  expect(byId('check-out-reconcile')).toBeDefined();
  press('check-out-submit');
  await settle();
  expect(w.posts.map((p) => [p.key, p.body.pinToken])).toEqual([
    ['key-1', PIN_TOKEN],
    ['key-1', PIN_TOKEN],
  ]);
  expect(byId('check-out-done')).toBeDefined();
});

test('SCR-59 collects the server balance with PIN and shows the reloaded balance afterwards', async () => {
  const w = wire({ balanceDue: [150_000, 0] });
  await mount(w, 'collect');
  expect(byId('collect-due')?.text).toContain('150.000');
  expect(call(byId('collect-amount')?.props.value === '150000' ? () => 'ok' : () => 'no')).toBe(
    'ok',
  );
  call(byId('collect-amount')?.props.onChangeText, '150001');
  await unlock();
  press('collect-submit');
  await settle();
  expect(byId('collect-amount-issue')?.text).toContain('không được vượt');
  expect(w.posts).toEqual([]);
  call(byId('collect-amount')?.props.onChangeText, '150000');
  await settle();
  press('collect-submit');
  await settle();
  expect(w.posts).toEqual([
    {
      path: '/payments',
      key: 'key-1',
      body: {
        bookingId: 'b1',
        type: 'BALANCE',
        method: 'CASH',
        amount: 150_000,
        pinToken: PIN_TOKEN,
      },
    },
  ]);
  expect(textOf()).toContain('Máy chủ đã ghi nhận khoản thu');
  expect(textOf()).toContain('Thành công');
  expect(byId('collect-due-after')?.text).toContain('0');
});

test('SCR-59 sends the chosen counter method and has no card fields', async () => {
  const w = wire();
  await mount(w, 'collect');
  press('collect-method-BANK_TRANSFER');
  await unlock();
  press('collect-submit');
  await settle();
  expect(w.posts[0]?.body).toMatchObject({ method: 'BANK_TRANSFER', type: 'BALANCE' });
  expect(JSON.stringify(w.posts)).not.toMatch(/card|cvv/i);
});

test('SCR-59 will not send before the balance is known or while offline', async () => {
  const w = wire({ online: false });
  await mount(w, 'collect');
  expect(byId('collect-balance-state')?.text).toContain('Cần kết nối mạng');
  expect(byId('collect-submit')?.props.accessibilityState).toMatchObject({ disabled: true });
  expect(byId('collect-reload')).toBeDefined();
  expect(w.posts).toEqual([]);
});
