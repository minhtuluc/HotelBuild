import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
export const schema = fileURLToPath(new URL('./schema.prisma', import.meta.url));
export const migrations = fileURLToPath(new URL('./migrations', import.meta.url));

/** Run the genuine pinned CLI without shell interpolation or credential output. */
export function prisma(args, ownerUrl) {
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...args], {
    env: { ...process.env, DATABASE_URL: ownerUrl },
    encoding: 'utf8',
  });
  return result.status ?? 1;
}
