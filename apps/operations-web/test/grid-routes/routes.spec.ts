import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
// HB-202: trần tường minh 30 giây vì ca dựng cả chuỗi client → BFF → TCP thật bằng tiến trình `tsx`,
// không phải ca sai — mặc định 5 giây của vitest chỉ đủ khi máy rảnh.
test('actual staff catalogue/grid route exports guard bearer/query/dates and proxy scope errors over TCP', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      fileURLToPath(new URL('./runtime.ts', import.meta.url)),
    ],
    { encoding: 'utf8', timeout: 15000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    actualRoutes: true,
    bearer: true,
    strictQuery: true,
    calendarBound: true,
    privateHeadersStripped: true,
    scopeDenial: true,
  });
  expect(result.stdout).not.toContain('synthetic-private-upstream');
}, 30_000);
