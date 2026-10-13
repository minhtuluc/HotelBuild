import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const here = path.dirname(fileURLToPath(import.meta.url));
function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'hb176-fixture-'));
  try {
    const git = (...args) => {
      const result = spawnSync(
        'git',
        ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', ...args],
        { cwd: root, encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git('init', '--quiet');
    writeFileSync(path.join(root, 'README.md'), 'Synthetic owned fixture\n');
    const commit = () => {
      git('add', '.');
      git('commit', '--quiet', '-m', 'Synthetic fixture');
      return git('rev-parse', 'HEAD');
    };
    commit();
    return run({ root, git, commit });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function scan(root) {
  return spawnSync('bash', [path.join(here, 'scan-git-secrets.sh'), root], {
    encoding: 'utf8',
    timeout: 30000,
  });
}
test('clean Git history passes with the actual scanner', () =>
  fixture(({ root }) => {
    const result = scan(root);
    assert.equal(result.status, 0, result.stderr);
  }));
test('new test fixture resembling a historic exception is still rejected', () =>
  fixture(({ root, commit }) => {
    const file = path.join(root, 'apps/operations-web/test/settings-api.spec.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    const original = readFileSync(
      path.resolve(here, '../../apps/operations-web/test/settings-api.spec.ts'),
      'utf8',
    );
    const fixtureKey = /const key = '([^']+)'/.exec(original);
    assert(fixtureKey, 'Existing historic synthetic fixture key');
    writeFileSync(file, '\n'.repeat(69) + `const key = '${fixtureKey[1]}';\n`);
    commit();
    const result = scan(root);
    assert.equal(result.status, 1, result.stderr);
  }));
test('new synthetic secret cannot hide behind local config/ignore/inline allow, and logs redact it', () =>
  fixture(({ root, commit }) => {
    const secret = 'gh' + 'p_' + randomBytes(18).toString('hex');
    writeFileSync(path.join(root, 'leak.ts'), `const token = '${secret}'; // gitleaks:allow\n`);
    const sha = commit();
    const first = scan(root);
    assert.equal(first.status, 1, 'Inline allow cannot suppress the synthetic secret');
    assert(!first.stdout.includes(secret));
    assert(!first.stderr.includes(secret));
    writeFileSync(
      path.join(root, '.gitleaks.toml'),
      "[extend]\nuseDefault = true\n[allowlist]\npaths = ['.*']\n",
    );
    commit();
    assert.equal(scan(root).status, 1, 'Source-local config cannot suppress the synthetic secret');
    writeFileSync(path.join(root, '.gitleaksignore'), `${sha}:leak.ts:github-pat:1\n`);
    commit();
    const result = scan(root);
    assert.equal(result.status, 1, 'Actual scanner must reject bypass attempts');
    assert(!result.stdout.includes(secret));
    assert(!result.stderr.includes(secret));
  }));
for (const removeAfterMerge of [false, true])
  test(`merge-only secret is rejected even with later deletion: ${removeAfterMerge}`, () =>
    fixture(({ root, git, commit }) => {
      const branch = git('branch', '--show-current');
      git('checkout', '--quiet', '-b', 'synthetic-feature');
      writeFileSync(path.join(root, 'feature.txt'), 'Synthetic feature');
      commit();
      git('checkout', '--quiet', branch);
      writeFileSync(path.join(root, 'main.txt'), 'Synthetic main');
      commit();
      git('merge', '--no-commit', '--no-ff', 'synthetic-feature');
      const secret = 'gh' + 'p_' + randomBytes(18).toString('hex');
      writeFileSync(path.join(root, 'merge-only.ts'), `const token = '${secret}';\n`);
      commit();
      assert.equal(git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3);
      assert.equal(git('ls-tree', '--name-only', 'HEAD^1', 'merge-only.ts'), '');
      assert.equal(git('ls-tree', '--name-only', 'HEAD^2', 'merge-only.ts'), '');
      if (removeAfterMerge) {
        git('rm', '--quiet', 'merge-only.ts');
        commit();
      }
      const result = scan(root);
      assert.equal(result.status, 1, 'Actual scanner must reject a merge-only secret');
      assert(!result.stdout.includes(secret));
      assert(!result.stderr.includes(secret));
    }));
test('bad archive checksum is rejected before extracting an executable', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hb176-install-'));
  try {
    const archive = path.join(root, 'invalid.tar.gz'),
      bin = path.join(root, 'bin');
    writeFileSync(archive, 'Synthetic invalid archive');
    const result = spawnSync('bash', [path.join(here, 'install-gitleaks.sh'), bin, archive], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert(!existsSync(path.join(bin, 'gitleaks')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('the checksum-pinned release installs and executes its real version', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hb176-install-'));
  try {
    const result = spawnSync(
      'bash',
      [
        path.join(here, 'install-gitleaks.sh'),
        root,
        ...(process.env.HB176_VERIFIED_ARCHIVE ? [process.env.HB176_VERIFIED_ARCHIVE] : []),
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const version = spawnSync(path.join(root, 'gitleaks'), ['version'], { encoding: 'utf8' });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), '8.30.1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
