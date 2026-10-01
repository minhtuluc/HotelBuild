import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const sourceRoot = resolve(root, 'packages/domain/src');
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [
    {
      languageOptions: { parserOptions: { projectService: false } },
      rules: Object.fromEntries(
        [
          'no-unsafe-assignment',
          'no-unsafe-member-access',
          'no-unsafe-call',
          'no-unsafe-return',
          'no-unsafe-argument',
          'no-floating-promises',
          'no-misused-promises',
          'await-thenable',
        ]
          .map((rule) => `@typescript-eslint/${rule}`)
          .map((rule) => [rule, 'off']),
      ),
    },
  ],
});
async function rules(code: string, path = 'packages/domain/src/probe.ts') {
  const results = await eslint.lintText(code, { filePath: resolve(root, path) });
  return results.flatMap((result) => result.messages.map((message) => message.ruleId));
}
const imports = [
  '@prisma/client',
  '@nestjs/core',
  'node:fs',
  'axios',
  'undici',
  'ioredis',
  'redis',
  'bullmq',
  'zod',
  'date-fns-tz',
  '@pinehill/contracts',
  'fs',
];
test.each(imports)('root preset rejects import %s', async (dependency) => {
  expect(await rules(`import '${dependency}';`)).toContain('no-restricted-imports');
});
const constructs = [
  'Date()',
  'Date(0)',
  'globalThis.Date()',
  'globalThis.Date(0)',
  'globalThis["Date"]()',
  'globalThis["Date"](0)',
  'Date.now()',
  'Date["now"]()',
  'new Date()',
  'performance.now()',
  'performance["now"]()',
  'Math.random()',
  'Math["random"]()',
  'crypto.randomUUID()',
  'crypto["getRandomValues"]([])',
  'process.env',
  'process["env"]',
  'import.meta.env',
  'import.meta["env"]',
  'window',
  'fetch("/")',
  'parseFloat("1")',
  '(1).toFixed(2)',
  '(1)["toFixed"](2)',
  'globalThis.fetch("/")',
  'globalThis.crypto.randomUUID()',
  'globalThis.Date.now()',
  'globalThis["Date"]["now"]()',
  'globalThis.Math.random()',
  'globalThis["Math"]["random"]()',
  'globalThis.performance.now()',
  'globalThis["performance"]["now"]()',
  'new globalThis.Date()',
  'new globalThis["Date"]()',
];
test.each(constructs)('root preset rejects %s', async (code) => {
  expect(await rules(`${code};`)).toContain('no-restricted-syntax');
});
test.each(['import("node:fs")', 'require("fs")', 'export * from "axios"'])(
  'rejects alternate dependencies %s',
  async (code) => {
    expect(
      (await rules(`${code};`)).some(
        (rule) => rule === 'no-restricted-imports' || rule === 'no-restricted-syntax',
      ),
    ).toBe(true);
  },
);
test('allows deterministic dates and relative imports, retains shared assertions/environment rules', async () => {
  expect(
    await rules(
      'import "./shared/clock.js"; new Date(0); new globalThis.Date(0); new globalThis["Date"](0);',
    ),
  ).toEqual([]);
  expect(await rules('const x = 1 as number;')).toContain('no-restricted-syntax');
  expect(await rules('process.env;')).toContain('no-restricted-properties');
  expect(await rules('import "node:fs";', 'packages/domain/test/probe.ts')).toEqual([]);
});
test.each([
  'customer-web',
  'operations-web',
  'customer-android',
  'operations-android',
  'api',
  'worker',
])('frontend boundary for %s', async (app) => {
  for (const dependency of ['@prisma/client', '@nestjs/core', 'zod', '@pinehill/domain']) {
    const found = await rules(`import '${dependency}';`, `apps/${app}/src/probe.ts`);
    expect(found.includes('no-restricted-imports')).toBe(
      !['api', 'worker'].includes(app) && dependency !== '@nestjs/core',
    );
  }
});
function dependency(node: ts.Node): ts.Node | undefined {
  if (ts.isExternalModuleReference(node)) return node.expression;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    return node.argument.literal;
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
  )
    return node.arguments[0];
  return undefined;
}
function scan(code: string, file: string): string[] {
  const failures: string[] = [];
  function visit(node: ts.Node) {
    const value = dependency(node);
    if (value) {
      const target = ts.isStringLiteral(value)
        ? resolve(dirname(file), value.text.replace(/\.js$/, '.ts'))
        : '';
      if (
        !ts.isStringLiteral(value) ||
        !value.text.startsWith('.') ||
        !target.startsWith(sourceRoot + sep) ||
        !existsSync(target)
      )
        failures.push(value.getText());
    }
    ts.forEachChild(node, visit);
  }
  visit(ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true));
  return failures;
}
test.each([
  'import "fs";',
  'export * from "axios";',
  'import("node:fs");',
  'require("redis");',
  'import "../../contracts/src/index.js";',
  'import(name);',
  'import fs = require("fs");',
  'type X = import("node:fs").Stats;',
  'import "./missing.js";',
])('AST scanner rejects %s', (code) => {
  expect(scan(code, resolve(sourceRoot, 'probe.ts'))).not.toEqual([]);
});
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)],
  );
}
test('every runtime dependency resolves inside domain source', () => {
  const runtimeFiles = files(sourceRoot).filter((file) => file.endsWith('.ts'));
  expect(runtimeFiles.length).toBeGreaterThan(0);
  for (const file of runtimeFiles) expect(scan(readFileSync(file, 'utf8'), file)).toEqual([]);
});
