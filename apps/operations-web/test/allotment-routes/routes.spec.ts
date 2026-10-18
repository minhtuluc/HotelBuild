import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
// HB-202: trần tường minh 30 giây vì ca dựng cả chuỗi client → BFF → TCP thật bằng tiến trình `tsx`,
// không phải ca sai — mặc định 5 giây của vitest chỉ đủ khi máy rảnh.
test('whole allotment client → actualBFF → TCP guards exact batch204, quota409 dates and401 single write', () => {
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
    wholeTransport: true,
    exactTagAndKey: true,
    quotaDatesWhitelist: true,
    one401Write: true,
    csrf: true,
    strictQuery: true,
    privateDataStripped: true,
  });
  expect(result.stdout).not.toContain('synthetic-private');
}, 30_000);
