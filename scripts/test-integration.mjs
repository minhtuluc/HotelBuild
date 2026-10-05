import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const required = {
  api: ['DATABASE_MIGRATION_URL', 'DATABASE_URL', 'REDIS_URL'],
  worker: ['REDIS_URL'],
};

/** Vitest may exit zero for skipped integrations; require every reported check to pass. */
export function assertIntegrationReport(report) {
  const assertions = report.testResults?.flatMap((suite) => suite.assertionResults ?? []) ?? [];
  if (
    report.success !== true || !(report.numTotalTests > 0) ||
    report.numPassedTests !== report.numTotalTests || report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 || report.numTodoTests !== 0 ||
    assertions.length !== report.numTotalTests ||
    assertions.some((assertion) => assertion.status !== 'passed')
  ) throw new Error('Integration checks failed, were skipped, or were not reported');
}

function run(target, args) {
  const result = spawnSync('pnpm', ['exec', ...args], {
    cwd: join(root, 'apps', target),
    env: { ...process.env, CI_REQUIRE_SERVICES: '1' },
    stdio: 'inherit',
    timeout: 600000,
  });
  if (result.error || result.status !== 0) throw new Error(`${target} integration command failed`);
}

async function main(target) {
  if (!Object.hasOwn(required, target)) throw new Error('Integration target must be api or worker');
  const missing = required[target].filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`CI_REQUIRE_SERVICES=1 requires ${missing.join(', ')}`);
  const directory = await mkdtemp(join(tmpdir(), 'hb007-integration-'));
  try {
    // Locked migration tests rotate app_rw's cluster-wide password; runtime checks must run first.
    if (target === 'api') run(target, ['tsx', 'test/integration/runtime.ts']);
    const report = join(directory, 'vitest.json');
    run(target, [
      'vitest', 'run', ...(target === 'api' ? ['test/migration', 'test/audit'] : ['test/redis.integration.spec.ts']),
      '--no-file-parallelism', '--reporter=default', '--reporter=json', `--outputFile.json=${report}`,
    ]);
    assertIntegrationReport(JSON.parse(await readFile(report, 'utf8')));
    console.info(`${target} integration checks passed without skips`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Integration runner failed');
    process.exitCode = 1;
  }
}
