import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
// HB-201 (cùng lớp ca với HB-200): trần tường minh 30 giây vì ca dựng hai tuyến BFF thật rồi gọi
// API giả qua TCP bằng tiến trình `tsx`, không phải ca sai — mặc định 5 giây của vitest chỉ đủ khi
// máy rảnh.
test('actual availability/rate-plans route exports guard bearer/query and forward over TCP', () => {
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
    availabilityQuery: true,
    ratePlanQuery: true,
    privateHeadersStripped: true,
  });
  expect(result.stdout).not.toContain('synthetic-private-upstream');
}, 30_000);
