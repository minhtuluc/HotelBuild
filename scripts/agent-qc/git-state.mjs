import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(repoDir, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoDir,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

function pathsFromGit(output) {
  return output.toString('utf8').split('\0').filter(Boolean);
}

export async function captureGitState(repoDir, baseSha) {
  const head = (await git(repoDir, ['rev-parse', 'HEAD'])).toString('utf8').trim();
  const base = baseSha ?? head;
  const [diff, trackedPaths, untrackedPaths] = await Promise.all([
    git(repoDir, ['diff', '--binary', base, '--']),
    git(repoDir, ['diff', '--name-only', '-z', base, '--']),
    git(repoDir, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);

  const hash = createHash('sha256');
  hash.update(head);
  hash.update('\0');
  hash.update(diff);
  const untracked = pathsFromGit(untrackedPaths);
  for (const path of untracked) {
    hash.update('\0');
    hash.update(path);
    hash.update('\0');
    hash.update(await readFile(join(repoDir, path)));
  }

  return {
    head,
    fingerprint: hash.digest('hex'),
    changedPaths: [...new Set([...pathsFromGit(trackedPaths), ...untracked])].sort(),
  };
}

export function hasChanged(before, after) {
  return before.fingerprint !== after.fingerprint;
}
