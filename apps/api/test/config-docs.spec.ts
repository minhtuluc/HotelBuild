/**
 * TD-46/TD-47 — mọi biến môi trường của API và worker phải có dòng trong kiến trúc §7.1.
 * Đọc **văn bản** hai `env.ts` (schema không xuất) để không thêm mã sản xuất chỉ phục vụ test.
 * `PREFIX_*` trong dấu huyền ở tài liệu phủ cả họ biến cùng tiền tố (nhịp/cỡ lô của từng hàng đợi worker).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');

/** Khoá ở cấp thân của `z.object({ … })` đầu tiên (thụt hai dấu cách), bỏ qua comment và khoá lồng. */
function schemaKeys(source: string): string[] {
  const start = source.indexOf('EnvSchema = z.object({');
  const end = source.indexOf('\n});', start);
  expect(start, 'không tìm thấy schema').toBeGreaterThan(-1);
  return [...source.slice(start, end).matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map(
    (match) => match[1] ?? '',
  );
}

function documented(): { exact: Set<string>; prefixes: string[] } {
  const doc = read('docs/04-thiet-ke/kien-truc.md');
  const from = doc.indexOf('### 7.1.');
  const section = doc.slice(from, doc.indexOf('\n---', from));
  const tokens = [...section.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
  return {
    exact: new Set(tokens),
    prefixes: tokens.filter((token) => token.endsWith('_*')).map((token) => token.slice(0, -1)),
  };
}

test.each([
  ['api', 'apps/api/src/config/env.ts', 20],
  ['worker', 'apps/worker/src/config/env.ts', 20],
])('mọi biến của %s có dòng trong kiến trúc §7.1', (_name, path, atLeast) => {
  const keys = schemaKeys(read(path));
  expect(keys.length, 'parser phải thấy gần đủ khoá').toBeGreaterThanOrEqual(atLeast);
  const { exact, prefixes } = documented();
  const missing = keys.filter(
    (key) => !exact.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)),
  );
  expect(missing, `thiếu dòng tài liệu cho: ${missing.join(', ')}`).toEqual([]);
});
