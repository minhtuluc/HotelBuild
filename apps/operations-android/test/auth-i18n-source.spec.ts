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
test('session restore and PIN input labels come from the operations catalog', () => {
  const files = ['../app/index.tsx', '../app/pin-setup.tsx'];
  const findings = files.flatMap((file) => {
    const url = new URL(file, import.meta.url);
    return hardcodedText(readFileSync(url, 'utf8'), url.pathname).map((text) => ({ file, text }));
  });
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
