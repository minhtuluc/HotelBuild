import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const runner = new URL('../scripts/test-integration.mjs', import.meta.url);
for (const [target, required] of [
  ['api', ['DATABASE_MIGRATION_URL', 'DATABASE_URL', 'REDIS_URL']],
  ['worker', ['REDIS_URL']],
]) {
  test(`${target} refuses absent services in CI before running optional tests`, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(runner), target], {
      env: { ...process.env, CI_REQUIRE_SERVICES: '1', DATABASE_MIGRATION_URL: '', DATABASE_URL: '', REDIS_URL: '' },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 1);
    for (const variable of required) assert.match(result.stderr, new RegExp(variable));
    assert.doesNotMatch(result.stdout + result.stderr, /tests passed|SKIP|\[skip\]/);
  });
}

test('integration report rejects every non-passing or absent check', async () => {
  const { assertIntegrationReport } = await import(runner.href);
  const passed = { success: true, numTotalTests: 1, numPassedTests: 1, numPendingTests: 0, numTodoTests: 0, numFailedTests: 0, testResults: [{ assertionResults: [{ status: 'passed' }] }] };
  assert.doesNotThrow(() => assertIntegrationReport(passed));
  for (const status of ['pending', 'skipped', 'todo', 'failed']) {
    assert.throws(() => assertIntegrationReport({ ...passed, testResults: [{ assertionResults: [{ status }] }] }));
  }
  for (const [key, value] of [['numTotalTests', 0], ['numPassedTests', 0], ['numPendingTests', 1], ['numTodoTests', 1], ['numFailedTests', 1], ['success', false], ['testResults', []]]) {
    assert.throws(() => assertIntegrationReport({ ...passed, [key]: value }));
  }
});
