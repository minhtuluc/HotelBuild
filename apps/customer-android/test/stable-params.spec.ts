import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';

vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
import { paramsKey, singleValues } from '../src/stable-params';

// HB-249: trên máy thật `useLocalSearchParams()` trả object mới mỗi lần render. Màn chi tiết phòng dùng nó
// làm dependency nên tải gói giá + báo giá lặp vô hạn (hơn 7.000 request trong vài phút, app treo).

test('the key depends on parameter content, not on object identity or key order', () => {
  expect(paramsKey({ a: '1', b: '2' })).toBe(paramsKey({ b: '2', a: '1' }));
  expect(paramsKey({ a: '1' })).not.toBe(paramsKey({ a: '2' }));
});

test('repeated parameters keep their first value and missing ones are dropped', () => {
  expect(singleValues({ b: ['x', 'y'], a: '1', c: undefined })).toEqual({ a: '1', b: 'x' });
});

test('no screen uses raw search params as a hook dependency', () => {
  const appDir = fileURLToPath(new URL('../app', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  const offenders = files(appDir).filter((file) => {
    const source = readFileSync(file, 'utf8');
    return /useLocalSearchParams/.test(source) && /\[params\]/.test(source);
  });
  expect(offenders).toEqual([]);
});
