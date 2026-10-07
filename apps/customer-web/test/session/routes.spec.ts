import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('actual server route exports pass HTTP login/refresh/logout and CSRF in a server process', () => {
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
  const evidence: unknown = JSON.parse(result.stdout);
  expect(evidence).toEqual({
    login: true,
    refresh: true,
    logout: true,
    csrf: true,
    secretsFiltered: true,
  });
  expect(result.stdout).not.toContain('synthetic-refresh-token');
});
