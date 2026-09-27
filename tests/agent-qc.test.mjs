import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { captureGitState, hasChanged } from '../scripts/agent-qc/git-state.mjs';

const execFileAsync = promisify(execFile);

async function git(repo, ...args) {
  await execFileAsync('git', args, { cwd: repo });
}

async function withRepo(run) {
  const repo = await mkdtemp(join(tmpdir(), 'agent-qc-'));
  try {
    await git(repo, 'init', '-q');
    await writeFile(join(repo, 'tracked.txt'), 'original');
    await writeFile(join(repo, '.gitignore'), '*.log\n');
    await git(repo, 'add', '.');
    await git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'initial');
    await run(repo);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

test('snapshot detects tracked edits, untracked bytes, and new commits', async () => {
  await withRepo(async (repo) => {
    const before = await captureGitState(repo);
    assert.equal(before.head.length, 40);
    assert.deepEqual(before.changedPaths, []);
    assert.equal(hasChanged(before, await captureGitState(repo)), false);

    await writeFile(join(repo, 'tracked.txt'), 'changed');
    const edited = await captureGitState(repo, before.head);
    assert.equal(hasChanged(before, edited), true);
    assert.deepEqual(edited.changedPaths, ['tracked.txt']);

    await writeFile(join(repo, 'new.txt'), 'one');
    const untracked = await captureGitState(repo, before.head);
    assert.notEqual(untracked.fingerprint, edited.fingerprint);
    assert.deepEqual(untracked.changedPaths, ['new.txt', 'tracked.txt']);

    await writeFile(join(repo, 'new.txt'), 'two');
    const newBytes = await captureGitState(repo, before.head);
    assert.notEqual(newBytes.fingerprint, untracked.fingerprint);

    await git(repo, 'add', '.');
    await git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'change');
    const committed = await captureGitState(repo, before.head);
    assert.equal(hasChanged(before, committed), true);
    assert.deepEqual(committed.changedPaths, ['new.txt', 'tracked.txt']);
  });
});

test('ignored logs do not change the snapshot', async () => {
  await withRepo(async (repo) => {
    const before = await captureGitState(repo);
    await writeFile(join(repo, 'run.log'), 'ignored log');
    const after = await captureGitState(repo);
    assert.equal(hasChanged(before, after), false);
    assert.deepEqual(after.changedPaths, []);
  });
});
