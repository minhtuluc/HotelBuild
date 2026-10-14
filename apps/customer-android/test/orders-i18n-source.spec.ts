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
test('order list, detail and stay text use the catalog, including accessibility labels', () => {
  const files = ['../src/orders.ts', '../app/booking/[code].tsx', '../app/(tabs)/bookings.tsx'];
  const findings = files.flatMap((file) =>
    hardcodedText(readFileSync(new URL(file, import.meta.url), 'utf8'), file).map((text) => ({
      file,
      text,
    })),
  );
  expect(findings).toEqual([]);
});
test('guard detects JSX, accessibility text and template pieces while excluding comments', () => {
  expect(
    hardcodedText(
      '// Không phải nội dung\nconst a = <Text accessibilityLabel="Đã thu">Còn nợ</Text>; const b = `Còn ${n} phòng`;',
      'control.tsx',
    ),
  ).toEqual(['Đã thu', 'Còn nợ', 'Còn', 'phòng']);
});
