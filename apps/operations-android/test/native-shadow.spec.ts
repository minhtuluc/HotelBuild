import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// HB-248: Metro trên Android ưu tiên `X.native.ts` khi có `import './X'`. Nếu cùng thư mục còn `X.ts`
// thì mọi export chỉ có ở `X.ts` (OfflineError, requireOnline, memoryStorage…) thành `undefined`
// trên máy thật, còn vitest chạy trên Node vẫn lấy `X.ts` nên không thấy. Cấm hai file trùng tên gốc.
const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = /\.(ts|tsx|js|jsx)$/;
const PLATFORM = /\.(native|android|ios)\.(ts|tsx|js|jsx)$/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : SOURCE.test(entry.name) ? [path] : [];
  });
}

export function shadowedModules(paths: readonly string[]): string[] {
  const plain = new Set(
    paths.filter((path) => !PLATFORM.test(path)).map((path) => path.replace(SOURCE, '')),
  );
  return paths
    .filter((path) => PLATFORM.test(path) && plain.has(path.replace(PLATFORM, '')))
    .sort();
}

test('no platform-specific file shadows a plain module with the same base name', () => {
  const found = shadowedModules([...files(join(root, 'src')), ...files(join(root, 'app'))]);
  expect(found.map((path) => relative(root, path))).toEqual([]);
});

test('the guard detects a shadowing pair and ignores explicitly named native modules', () => {
  expect(
    shadowedModules([
      '/x/src/netinfo.ts',
      '/x/src/netinfo.native.ts',
      '/x/src/netinfo-device.native.ts',
      '/x/src/boot.native.ts',
    ]),
  ).toEqual(['/x/src/netinfo.native.ts']);
});
