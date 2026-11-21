import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
// Go-live: BFF từng chuyển tiếp tới `/auth/change-password` (không tồn tại) ⇒ OWNER mới kẹt ở màn đổi mật khẩu.
test('đổi mật khẩu qua BFF tới đúng POST /api/v1/auth/password của API', () => {
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
  expect(JSON.parse(result.stdout)).toEqual([{ method: 'POST', path: '/api/v1/auth/password' }]);
}, 30_000);
