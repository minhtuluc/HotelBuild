import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { expect, test } from 'vitest';
import {
  messages,
  paymentText,
} from '../../src/app/(guest)/booking/[bookingId]/pay/messages-payment';
import { paymentSurface } from '../../src/app/(guest)/booking/[bookingId]/pay/payment-panels';
import type { PaymentView } from '../../src/app/(guest)/booking/[bookingId]/pay/payment-flow';

const folder = new URL('../../src/app/(guest)/booking/[bookingId]/pay/', import.meta.url);
function hardcodedText(source: string, name: string): string[] {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const text: string[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)) &&
      /[À-ÖØ-öø-ỹĐđ]/u.test(node.text)
    )
      text.push(node.text.trim());
    ts.forEachChild(node, visit);
  }
  expect(
    ts.transpileModule(source, { fileName: name, reportDiagnostics: true }).diagnostics,
  ).toEqual([]);
  visit(ast);
  return text;
}
test('payment flow keeps Vietnamese literal and JSX text in its catalog', () => {
  const findings = readdirSync(folder)
    .filter((name) => /\.tsx?$/.test(name) && name !== 'messages-payment.ts')
    .flatMap((name) =>
      hardcodedText(readFileSync(new URL(name, folder), 'utf8'), name).map((text) => ({
        name,
        text,
      })),
    );
  expect(findings).toEqual([]);
});
test('scanner sees JSX, string and template fragments but ignores comments', () => {
  expect(
    hardcodedText(
      '// Không phải nội dung\nconst a = "Đã thu"; const b = `Còn ${n} phòng`; const c = <p>Đặt phòng</p>;',
      'control.tsx',
    ),
  ).toEqual(['Đã thu', 'Còn', 'phòng', 'Đặt phòng']);
});
test('catalog contains unchanged payment labels and interpolation templates', () => {
  const expected = {
    summaryBooking: 'Đặt phòng {code}',
    total: 'Tổng tiền phòng',
    paid: 'Đã thu',
    balance: 'Còn nợ theo sổ cái',
    deposit: 'Cọc cần trả theo máy chủ',
    bookingStatus: 'Trạng thái đặt phòng từ máy chủ',
    holdExpiry: 'Hạn giữ chỗ: {time}. Thời hạn giữ chỗ độc lập với giao dịch thanh toán.',
    provider: 'Cổng thanh toán',
    selectedProvider: 'Cổng đã chọn: {provider}.',
    observed: 'Giao dịch đã kiểm tra',
    transaction: 'Mã giao dịch:',
    paymentStatus: 'Số tiền: {amount} · Trạng thái máy chủ: {status}',
    paymentExpiry: 'Hạn giao dịch: {time}.',
  };
  for (const [key, value] of Object.entries(expected))
    expect(Object.entries(messages).find(([name]) => name === key)?.[1]).toBe(value);
});
test('localized validation and conflict preserve the existing state protocol', () => {
  const view: PaymentView = {
    phase: 'ready',
    busy: false,
    changed: false,
  };
  const reload = () => undefined;
  expect(paymentSurface(view, true, reload, 'reference')).toEqual({
    kind: 'validationError',
    details: [{ field: 'method', issue: 'Hãy chọn VNPay hoặc MoMo.' }],
  });
  expect(paymentSurface({ ...view, changed: true }, false, reload, 'reference')).toEqual({
    kind: 'conflict',
    currentVersion: 'máy chủ mới',
    attemptedVersion: 'bản trước',
    onReload: reload,
  });
});
test('templates interpolate the server display values without changing payment evidence', () => {
  expect(paymentText('summaryBooking', { code: 'PH-261024-ABCDE' })).toBe(
    'Đặt phòng PH-261024-ABCDE',
  );
  expect(paymentText('paymentStatus', { amount: '49.501 ₫', status: 'PENDING' })).toBe(
    'Số tiền: 49.501 ₫ · Trạng thái máy chủ: PENDING',
  );
  expect(paymentText('selectedProvider', { provider: messages.providerMomo })).toBe(
    'Cổng đã chọn: MoMo.',
  );
});
