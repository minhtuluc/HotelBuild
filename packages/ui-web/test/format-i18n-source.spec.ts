// @vitest-environment node
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
test('HB-218: format.ts chỉ còn lỗi lập trình và nhãn bắt buộc (giờ VN); câu hiển thị ở danh mục', () => {
  const source = readFileSync(new URL('../src/format.ts', import.meta.url), 'utf8');
  expect(hardcodedText(source, 'format.ts')).toEqual([
    'Tiền phải là số nguyên VND (BR-GEN-01).',
    'Mốc thời gian không hợp lệ:',
    '(giờ VN)',
  ]);
});
