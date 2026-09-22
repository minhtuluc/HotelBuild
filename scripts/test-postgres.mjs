import { spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.error('test:postgres requires DATABASE_URL for a disposable PostgreSQL 16 cluster (CREATE DATABASE / CREATE ROLE privileges). No embedded fallback.');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/database.test.mjs'], {
    stdio: 'inherit', env: { ...process.env, OOAD_DB: 'postgres' },
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
