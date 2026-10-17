import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

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
});
