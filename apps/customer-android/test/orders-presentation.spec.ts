import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import BookingsScreen from '../app/(tabs)/bookings';
import BookingDetailScreen from '../app/booking/[code]';
import { booking } from './payment-fixtures';

const runtime = vi.hoisted(() => {
  const hooks: unknown[] = [],
    shares: unknown[] = [],
    routes: unknown[] = [];
  return { hooks, shares, routes };
});
// Supply a render snapshot without running effects. Actual screen components,
// Session construction, catalog, formatters and event handlers execute.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => [
    runtime.hooks.length ? runtime.hooks.shift() : initial,
    () => undefined,
  ],
  useMemo: (calculate: () => unknown) => calculate(),
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Share: {
    share: async (payload: unknown) => {
      runtime.shares.push(payload);
    },
  },
}));
vi.mock('expo-router', () => ({
  Link: 'Link',
  useLocalSearchParams: () => ({ code: 'SYN079' }),
  useRouter: () => ({ push: (route: unknown) => runtime.routes.push(route) }),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => {
    throw Error('Presentation must not access secure storage');
  },
  setItemAsync: async () => {
    throw Error('Presentation must not write secure storage');
  },
  deleteItemAsync: async () => {
    throw Error('Presentation must not delete secure storage');
  },
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: {
    fetch: async () => {
      throw Error('Presentation must not query connectivity');
    },
  },
}));
interface Props {
  children?: ReactNode;
  accessible?: boolean;
  accessibilityLabel?: string;
  onPress?: () => void;
  href?: unknown;
  'data-testid'?: string;
}
function component(value: unknown): value is (props: Props) => ReactNode {
  return typeof value === 'function';
}
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Props>(child)) return [];
    if (component(child.type)) return elements(child.type(child.props));
    return [child, ...elements(child.props.children)];
  });
}
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return isValidElement<Props>(child) ? textOf(child.props.children) : '';
    })
    .join('');
}
beforeEach(() => {
  runtime.hooks.length = 0;
  runtime.shares.length = 0;
  runtime.routes.length = 0;
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'https://synthetic.test/api/v1');
  vi.stubEnv('EXPO_PUBLIC_APP_VARIANT', 'development');
  vi.stubGlobal('fetch', async () => {
    throw Error('Presentation must not call the API');
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test.each(['ready', 'offline'] as const)(
  'list %s uses localized dates and original balances in text and accessibility',
  (kind) => {
    const outcome =
      kind === 'ready'
        ? { kind, bookings: [booking] }
        : {
            kind,
            cached: [booking],
            cachedAt: '2026-12-01T00:00:00Z',
          };
    runtime.hooks.push(true, outcome, '', false);
    const nodes = elements(BookingsScreen());
    expect(
      nodes.filter((node) => node.type === 'Text').map((node) => textOf(node.props.children)),
    ).toContain('24/12/2026 → 26/12/2026 · 2 đêm · 1 phòng');
    expect(nodes.find((node) => node.props.accessible)?.props.accessibilityLabel).toBe(
      'SYN079. Đang giữ chỗ. 24/12/2026 → 26/12/2026 · 2 đêm · 1 phòng. Đã trả 250.499 ₫ · Còn phải trả 749.501 ₫',
    );
    nodes
      .find((node) => node.props.accessibilityLabel === 'Xem chi tiết SYN079')
      ?.props.onPress?.();
    expect(runtime.routes).toEqual([{ pathname: '/booking/[code]', params: { code: 'SYN079' } }]);
    if (kind === 'offline')
      expect(
        textOf(nodes.find((node) => node.props['data-testid'] === 'orders-stale')?.props.children),
      ).toBe('Đang offline — hiện bản đã tải lúc 01/12/2026 07:00 (giờ VN), có thể đã cũ.');
  },
);
test.each(['ready', 'offline'] as const)(
  'detail %s retains payment destination, balances, stale warning and share content',
  (kind) => {
    runtime.hooks.push(
      true,
      kind === 'ready'
        ? { kind, booking }
        : {
            kind,
            booking,
            cachedAt: '2026-12-01T00:00:00Z',
          },
      false,
    );
    const nodes = elements(BookingDetailScreen());
    const link = nodes.find((node) => node.type === 'Link');
    expect(link?.props.href).toEqual({
      pathname: '/payment/[bookingId]',
      params: { bookingId: 'b1' },
    });
    expect(link?.props.accessibilityLabel).toBe('Thanh toán tiền cọc');
    expect(textOf(link?.props.children)).toBe('Thanh toán tiền cọc');
    expect(
      textOf(nodes.find((node) => node.props['data-testid'] === 'order-stay')?.props.children),
    ).toBe('Kỳ ở: 24/12/2026 → 26/12/2026 · 2 đêm · 1 phòng');
    expect(
      nodes.filter((node) => node.type === 'Text').map((node) => textOf(node.props.children)),
    ).toEqual(expect.arrayContaining(['Đã trả 250.499 ₫', 'Còn phải trả 749.501 ₫']));
    nodes
      .find((node) => node.props.accessibilityLabel === 'Chia sẻ / lưu xác nhận')
      ?.props.onPress?.();
    expect(runtime.shares).toEqual([
      { message: 'SYN079 · 24/12/2026 → 26/12/2026 · 2 đêm · 1 phòng · Tổng tiền: 1.000.000 ₫' },
    ]);
    if (kind === 'offline')
      expect(
        textOf(nodes.find((node) => node.props['data-testid'] === 'order-stale')?.props.children),
      ).toBe('Đang offline — hiện bản đã tải lúc 01/12/2026 07:00 (giờ VN), có thể đã cũ.');
  },
);
test.each([{ kind: 'notFound' }, { kind: 'offline', booking: null, cachedAt: null }] as const)(
  'detail without a booking does not offer payment or sharing: $kind',
  (outcome) => {
    runtime.hooks.push(true, outcome, false);
    const nodes = elements(BookingDetailScreen());
    expect(nodes.some((node) => node.type === 'Link')).toBe(false);
    expect(nodes.some((node) => node.props.accessibilityLabel === 'Chia sẻ / lưu xác nhận')).toBe(
      false,
    );
    expect(runtime.shares).toEqual([]);
  },
);
