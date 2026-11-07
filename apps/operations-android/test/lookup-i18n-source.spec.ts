import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, test } from 'vitest';

function hardcodedText(source: string, name: string): string[] {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)) &&
      /[À-ÖØ-öø-ỹĐđ]/u.test(node.text)
    )
      found.push(node.text.trim());
    ts.forEachChild(node, visit);
  }
  expect(
    ts.transpileModule(source, { fileName: name, reportDiagnostics: true }).diagnostics,
  ).toEqual([]);
  visit(ast);
  return found;
}
test('HB-218: màn tra cứu/đến/ở dùng danh mục cho nhãn kỳ ở, không ghép "đêm" cứng', () => {
  const files = [
    '../src/lookup/rows.tsx',
    '../src/arrivals/card.tsx',
    '../src/arrivals/detail.tsx',
    '../src/stay/card.tsx',
    '../src/stay/checkout.tsx',
  ];
  const findings = files.flatMap((file) =>
    hardcodedText(readFileSync(new URL(file, import.meta.url), 'utf8'), file).map((text) => ({
      file,
      text,
    })),
  );
  expect(findings).toEqual([]);
  // Hàm thuần nhận nhãn từ nơi gọi: không tự thêm đơn vị.
  expect(
    hardcodedText(
      readFileSync(new URL('../src/lookup/view.ts', import.meta.url), 'utf8'),
      'view.ts',
    ),
  ).not.toContain('đêm');
});
