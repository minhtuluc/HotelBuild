import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import type * as ReactNamespace from 'react';
import { expect, test, vi } from 'vitest';
import ConfirmHoldScreen from '../app/booking/confirm';
import { calendarDateLabel } from '../src/calendar-date';
import { t } from '../src/strings';

// Host bindings cannot load in Node. Only the platform primitives are substituted; the screen
// component, catalog, calendar formatter and props actually execute.
const runtime = vi.hoisted(() => {
  const hooks: unknown[] = [];
  return { hooks };
});
vi.mock('react', async (original) => ({
  ...(await original<typeof ReactNamespace>()),
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
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    propertyId: 'synthetic-property',
    roomTypeId: 'rt-1',
    checkIn: '2026-12-24',
    checkOut: '2026-12-26',
    adults: '2',
    children: '0',
    roomCount: '2',
    ratePlanCode: 'SAVER3',
    quoteId: 'q1',
  }),
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock('../src/session-factory', () => ({
  createSession: () => ({
    silentRefresh: async () => undefined,
    hasAccessToken: () => true,
    apiClient: () => ({}),
  }),
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: { fetch: async () => ({ isConnected: true }) },
}));

interface Props {
  children?: ReactNode;
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
const ISO = /\d{4}-\d{2}-\d{2}/;

test('calendar date label reorders an API date-only value without building an instant', () => {
  expect(calendarDateLabel('2026-12-24')).toBe('24/12/2026');
  expect(calendarDateLabel('2026-01-02')).toBe('02/01/2026');
  // Non-calendar input is left untouched rather than guessed at.
  expect(calendarDateLabel('2026-12-24T00:00:00Z')).toBe('2026-12-24T00:00:00Z');
});

test('confirmation screen shows the stay line as dd/MM/yyyy from the catalog, never ISO', () => {
  runtime.hooks.push(
    true,
    { fullName: '', phone: '' },
    '',
    null,
    null,
    null,
    false,
    null,
    false,
    0,
  );
  const labels = elements(ConfirmHoldScreen())
    .filter((node) => node.type === 'Text')
    .map((node) => textOf(node.props.children));
  expect(labels).toContain('24/12/2026 → 26/12/2026 · 2 phòng');
  expect(labels.some((label) => ISO.test(label))).toBe(false);
  expect(t('hold.criteria', { checkIn: '2026-12-24', checkOut: '2026-12-26', roomCount: 2 })).toBe(
    '2026-12-24 → 2026-12-26 · 2 phòng',
  );
});
