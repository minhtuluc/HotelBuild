import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
test('actual customer Next journey exports use live HTTP and the guest session', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      fileURLToPath(new URL('./journey-runtime.ts', import.meta.url)),
    ],
    { encoding: 'utf8', timeout: 15000 },
  );
  expect(result.status, result.stderr).toBe(0);
  const evidence: unknown = JSON.parse(result.stdout);
  expect(evidence).toEqual({
    publicSearch: true,
    publicQuote: true,
    sessionRequired: true,
    authenticatedWrites: true,
    replay: true,
    csrf: true,
    release: true,
    secretsFiltered: true,
  });
  expect(result.stdout).not.toContain('synthetic-access');
  expect(result.stdout).not.toContain('synthetic-refresh');
});
