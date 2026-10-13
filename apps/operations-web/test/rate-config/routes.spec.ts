import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
test('actual rate BFF and TCP preserve typed commands/privacy/errors with pretransport guards', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      fileURLToPath(new URL('./routes-runtime.ts', import.meta.url)),
    ],
    { encoding: 'utf8', timeout: 15000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    read: true,
    plan204: true,
    policy200: true,
    guards: true,
    rowErrors: true,
    privateStripped: true,
    largePolicy: true,
    defaultBudget: true,
    boundedPolicy: true,
  });
  expect(result.stdout).not.toContain('SYNTHETIC_PRIVATE');
});
