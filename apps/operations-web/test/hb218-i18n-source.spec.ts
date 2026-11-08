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
test('HB-218: các điểm đã sửa dùng danh mục, không còn chuỗi tiếng Việt cứng', () => {
  const files = [
    '../src/features/hb132-scr40-cau-hinh-kenh/forms.tsx',
    '../src/session/login-model.ts',
    '../src/session/view-text.ts',
    '../src/app/(ops)/front-desk/front-desk-api.ts',
  ];
  const findings = files.flatMap((file) =>
    hardcodedText(readFileSync(new URL(file, import.meta.url), 'utf8'), file).map((text) => ({
      file,
      text,
    })),
  );
  expect(findings).toEqual([]);
});
test('guard bắt chuỗi cứng trong JSX/thuộc tính và bỏ qua chú thích', () => {
  expect(hardcodedText('// Huỷ\nconst a = <Dialog cancelLabel="Huỷ" />;', 'control.tsx')).toEqual([
    'Huỷ',
  ]);
});
