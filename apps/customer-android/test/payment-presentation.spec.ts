import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import { PaymentSummary, PaymentMethods, PaymentActions } from '../src/payment/panels';
import type { PaymentView } from '../src/payment/flow';
import { booking, balance, payment } from './payment-fixtures';

// Node cannot load native host bindings. Only host primitives are substituted;
// actual React components, translation, formatters and callbacks are exercised.
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View' }));
vi.mock('expo-router', () => ({ Link: 'Link' }));
interface HostProps {
  children?: ReactNode;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityState?: { checked?: boolean; disabled?: boolean };
  disabled?: boolean;
  onPress?: () => void;
}
function functionComponent(value: unknown): value is (props: HostProps) => ReactNode {
  return typeof value === 'function';
}
function elements(node: ReactNode): ReactElement<HostProps>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<HostProps>(child)) return [];
    if (functionComponent(child.type)) return elements(child.type(child.props));
    return [child, ...elements(child.props.children)];
  });
}
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (!isValidElement<HostProps>(child)) return '';
      return textOf(child.props.children);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
const view: PaymentView = {
  phase: 'ready',
  busy: false,
  offer: { booking, balance },
};
test('summary renders server amounts as integer VND with the currency symbol', () => {
  const labels = elements(PaymentSummary({ view }))
    .filter((element) => element.type === 'Text')
    .map((element) => textOf(element.props.children));
  expect(labels).toEqual(
    expect.arrayContaining([
      'Đặt phòng SYN079',
      'Tổng tiền phòng: 1.000.000 ₫',
      'Đã thu: 250.499 ₫',
      'Còn nợ theo sổ cái: 749.501 ₫',
      'Cọc cần trả theo máy chủ: 49.501 ₫',
      'Trạng thái đặt phòng từ máy chủ: HELD',
    ]),
  );
  expect(labels.join(' ')).not.toContain('300.000');
});
test('missing authoritative amount is unavailable, never computed from a percentage', () => {
  const unavailable: PaymentView = {
    ...view,
    offer: { booking, balance: { ...balance, onlineDepositAmount: null } },
  };
  const labels = elements(PaymentSummary({ view: unavailable }))
    .filter((element) => element.type === 'Text')
    .map((element) => textOf(element.props.children));
  expect(labels).toContain('Cọc cần trả theo máy chủ: Chưa có dữ liệu');
  expect(labels.join(' ')).not.toContain('300.000');
});
test('provider labels remain accessible and selection invokes the actual handler', () => {
  const selected: string[] = [];
  const nodes = elements(
    PaymentMethods({ method: 'VNPAY', disabled: false, onChange: (value) => selected.push(value) }),
  );
  const radio = nodes.find((element) => element.props.accessibilityLabel === 'MoMo');
  expect(radio?.props.accessibilityState).toEqual({ checked: false, disabled: false });
  radio?.props.onPress?.();
  expect(selected).toEqual(['MOMO']);
});
test('confirmation preserves selected provider and calls confirm only through its action', () => {
  let confirmations = 0;
  const nodes = elements(
    PaymentActions({
      view: { ...view, phase: 'confirm' },
      method: 'MOMO',
      setMethod: () => undefined,
      prepare: () => undefined,
      confirm: () => confirmations++,
      open: () => undefined,
      check: () => undefined,
    }),
  );
  expect(
    nodes.filter((node) => node.type === 'Text').map((node) => textOf(node.props.children)),
  ).toContain(
    'Cổng đã chọn: MoMo. Thanh toán mở trình duyệt hệ thống; khi trở về sẽ đọc lại máy chủ.',
  );
  const action = nodes.find(
    (node) => node.props.accessibilityLabel === 'Xác nhận và mở cổng thanh toán',
  );
  expect(confirmations).toBe(0);
  action?.props.onPress?.();
  expect(confirmations).toBe(1);
});
test('summary preserves server status and explicit Vietnam time labels', () => {
  const nodes = elements(
    PaymentSummary({ view: { ...view, payment, checkedAt: '2026-12-01T00:00:00Z' } }),
  );
  const text = nodes
    .filter((node) => node.type === 'Text')
    .map((node) => textOf(node.props.children));
  expect(text).toContain('Trạng thái giao dịch từ máy chủ: PENDING');
  expect(text).toContain('Đã đọc máy chủ lúc 01/12/2026 07:00 (giờ VN)');
});
test.each(['expired', 'forbidden'] as const)(
  'denied phase %s offers the existing login link without a payment action',
  (phase) => {
    const nodes = elements(
      PaymentActions({
        view: { ...view, phase },
        method: 'MOMO',
        setMethod: () => undefined,
        prepare: () => undefined,
        confirm: () => undefined,
        open: () => undefined,
        check: () => undefined,
      }),
    );
    const login = nodes.find((node) => node.type === 'Link');
    expect(login?.props.accessibilityLabel).toBe('Về đăng nhập');
    expect(textOf(login?.props.children)).toBe('Về đăng nhập');
    expect(nodes.filter((node) => node.props.accessibilityRole === 'button')).toHaveLength(0);
  },
);
test('unsafe portal URL remains a warning without an open action', () => {
  const nodes = elements(
    PaymentActions({
      view: {
        ...view,
        phase: 'pending',
        fullPayment: { ...payment, paymentUrl: 'javascript:alert(1)' },
      },
      method: 'MOMO',
      setMethod: () => undefined,
      prepare: () => undefined,
      confirm: () => undefined,
      open: () => {
        throw Error('Unsafe URL must not be opened');
      },
      check: () => undefined,
    }),
  );
  expect(
    nodes.filter((node) => node.type === 'Text').map((node) => textOf(node.props.children)),
  ).toContain('Máy chủ chưa trả liên kết HTTPS an toàn. Hãy kiểm tra trạng thái giao dịch.');
  expect(
    nodes.filter(
      (node) => node.props.accessibilityLabel === 'Mở lại cổng thanh toán cho giao dịch này',
    ),
  ).toHaveLength(0);
});
