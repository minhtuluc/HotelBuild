import { readFileSync, readdirSync } from 'node:fs';
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
test('payment route, accessibility labels and screen text come from the catalog', () => {
  const folder = new URL('../src/payment/', import.meta.url);
  const files = readdirSync(folder)
    .filter((name) => /\.tsx?$/.test(name) && name !== 'messages.ts')
    .map((name) => new URL(name, folder));
  files.push(new URL('../app/payment/[bookingId].tsx', import.meta.url));
  const findings = files.flatMap((file) =>
    hardcodedText(readFileSync(file, 'utf8'), file.pathname).map((text) => ({
      file: file.pathname.split('/customer-android/')[1],
      text,
    })),
  );
  expect(findings).toEqual([]);
});
test('source guard detects JSX, accessibility attributes and template fragments, not comments', () => {
  expect(
    hardcodedText(
      '// Không phải nội dung\nconst a = <Text accessibilityLabel="Đã thu">Còn nợ</Text>; const b = `Còn ${n} phòng`;',
      'control.tsx',
    ),
  ).toEqual(['Đã thu', 'Còn nợ', 'Còn', 'phòng']);
});
