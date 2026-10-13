import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
test('whole admin client → actual BFF → TCP: marker/key/tag, one write, typed errors and private data stripped', () => {
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
    oneWrite: true,
    csrf: true,
    keyAndVersion: true,
    validationFields: true,
    privateDataStripped: true,
  });
  expect(result.stdout).not.toContain('synthetic-private');
});
