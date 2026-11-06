/**
 * Harness tối thiểu (không có renderer thật trong repo): hook được thay bằng kho theo thứ tự gọi, thành phần
 * hàm được bung đệ quy thành cây phần tử máy chủ. Các `vi.mock` nằm ở tệp test (được nâng lên đầu tệp).
 */
import { isValidElement } from 'react';

export interface HookStore {
  slots: Map<number, unknown>;
  index: number;
  effects: Map<number, () => unknown>;
  ran: Set<number>;
}

export interface Node {
  type: string;
  props: Record<string, unknown>;
  children: Node[];
  text: string;
}

export const call = (fn: unknown, ...args: unknown[]): unknown => {
  if (typeof fn !== 'function') throw new TypeError('not callable');
  return Reflect.apply(fn, undefined, args);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function host(type: string, props: Record<string, unknown>): Node[] {
  const rendered =
    type === 'FlatList' && Array.isArray(props.data)
      ? props.data.flatMap((item: unknown) => expand(call(props.renderItem, { item })))
      : expand(props.children);
  return [{ type, props, children: rendered, text: rendered.map((child) => child.text).join('') }];
}

export function expand(node: unknown): Node[] {
  if (typeof node === 'string' || typeof node === 'number')
    return [{ type: '#text', props: {}, children: [], text: String(node) }];
  if (Array.isArray(node)) return node.flatMap((child: unknown) => expand(child));
  if (!isRecord(node) || !isValidElement(node)) return [];
  const props = isRecord(node.props) ? node.props : {};
  if (typeof node.type === 'function') return expand(call(node.type, props));
  if (typeof node.type === 'symbol') return expand(props.children);
  return host(String(node.type), props);
}

export const walk = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...walk(n.children)]);

export function driver(store: HookStore, element: () => unknown) {
  let tree: Node[] = [];
  const render = (): void => {
    store.index = 0;
    tree = expand(element());
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 6; round += 1) {
      render();
      for (const [slot, effect] of store.effects) {
        if (store.ran.has(slot)) continue;
        store.ran.add(slot);
        call(effect);
      }
      await flush();
    }
    render();
  };
  return {
    settle,
    byId: (id: string): Node | undefined => walk(tree).find((n) => n.props.testID === id),
    text: (): string => tree.map((n) => n.text).join(' | '),
    press(id: string): void {
      const node = walk(tree).find((n) => n.props.testID === id);
      if (!node) throw new Error(`no node ${id}; tree: ${tree.map((n) => n.text).join(' | ')}`);
      call(node.props.onPress);
    },
    type(id: string, value: string): void {
      const node = walk(tree).find((n) => n.props.testID === id);
      if (!node) throw new Error(`no node ${id}`);
      call(node.props.onChangeText, value);
    },
  };
}
