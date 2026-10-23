/**
 * Harness giao diện dùng chung cho các spec mới (HB-210). Repo không có renderer thật nên: hook thay bằng kho
 * theo thứ tự gọi (`mockReact`), thành phần hàm bung đệ quy thành cây phần tử máy chủ ('View', 'Pressable'…).
 * Cố ý **không** import 'react' (spec truyền `isValidElement` vào) để `vi.mock('react', …)` nạp tệp này bằng
 * `import()` động mà không vòng lặp. Reader/Writer/Session/ApiClient trong spec là mã thật; chỉ `fetch`, đồng
 * hồ và nguyên thủy giao diện native là biên được thay.
 */
export const h = {
  slots: new Map<number, unknown>(),
  index: 0,
  effects: new Map<number, () => unknown>(),
  ran: new Set<number>(),
};

export function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== 'function') throw new TypeError('not callable');
  return Reflect.apply(fn, undefined, args);
}

export function mockReact<T extends object>(real: T): T {
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
}

export const reactNativeMock = {
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
};

export interface Node {
  type: string;
  props: Record<string, unknown>;
  children: Node[];
  text: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function createHarness(isValidElement: (value: object) => boolean) {
  function host(type: string, props: Record<string, unknown>): Node[] {
    const rendered =
      type === 'FlatList' && Array.isArray(props.data)
        ? props.data.flatMap((item: unknown) => expand(call(props.renderItem, { item })))
        : expand(props.children);
    return [
      { type, props, children: rendered, text: rendered.map((child) => child.text).join('') },
    ];
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

  const walk = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...walk(n.children)]);

  let tree: Node[] = [];
  let element: () => unknown = () => null;

  const render = (): void => {
    h.index = 0;
    tree = expand(element());
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  /** Chạy các effect mới (mỗi vị trí hook một lần) rồi vẽ lại cho tới khi ổn định. */
  const settle = async (): Promise<void> => {
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
  };
  const byId = (id: string): Node | undefined => walk(tree).find((n) => n.props.testID === id);
  const textOf = (): string => tree.map((n) => n.text).join(' | ');
  const press = (id: string): void => {
    const node = byId(id);
    if (!node) throw new Error(`no node ${id}; tree: ${textOf()}`);
    call(node.props.onPress);
  };
  const reset = (): void => {
    h.slots.clear();
    h.effects.clear();
    h.ran.clear();
    h.index = 0;
  };
  return {
    setElement: (next: () => unknown) => {
      element = next;
    },
    render,
    settle,
    byId,
    textOf,
    press,
    reset,
  };
}
