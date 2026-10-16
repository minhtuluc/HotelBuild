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

/** Giá trị của một khoá chuỗi trong catalog `src/strings.ts`, đọc bằng AST (không import UI-native). */
function catalogValue(source: string, key: string): string | undefined {
  const ast = ts.createSourceFile('strings.ts', source, ts.ScriptTarget.Latest, true);
  let value: string | undefined;
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isStringLiteralLike(node.name) &&
      node.name.text === key &&
      ts.isStringLiteralLike(node.initializer)
    )
      value = node.initializer.text;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return value;
}

/** Expression của `accessibilityLabel` trên phần tử JSX có tên `tag`, ví dụ `t('session.restoring')`. */
function accessibilityLabelOf(source: string, name: string, tag: string): string | undefined {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  let expression: string | undefined;
  function visit(node: ts.Node): void {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === tag) {
      for (const property of node.attributes.properties) {
        if (!ts.isJsxAttribute(property) || property.name.getText(ast) !== 'accessibilityLabel')
          continue;
        const initializer = property.initializer;
        if (initializer && ts.isJsxExpression(initializer) && initializer.expression)
          expression = initializer.expression.getText(ast);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return expression;
}

test('session restore accessibility label comes from the catalog, not a hardcoded literal', () => {
  const stringsPath = '../src/strings.ts';
  expect(
    catalogValue(readFileSync(new URL(stringsPath, import.meta.url), 'utf8'), 'session.restoring'),
  ).toBe('Đang khôi phục phiên');

  const screenPath = '../app/index.tsx';
  const source = readFileSync(new URL(screenPath, import.meta.url), 'utf8');
  expect(accessibilityLabelOf(source, screenPath, 'ActivityIndicator')).toBe(
    "t('session.restoring')",
  );
  expect(hardcodedText(source, screenPath)).toEqual([]);
});

test('guard detects JSX, accessibility text and template pieces while excluding comments', () => {
  expect(
    hardcodedText(
      '// Không phải nội dung\nconst a = <ActivityIndicator accessibilityLabel="Đang khôi phục phiên" />; const b = `Còn ${n} phòng`;',
      'control.tsx',
    ),
  ).toEqual(['Đang khôi phục phiên', 'Còn', 'phòng']);
});
