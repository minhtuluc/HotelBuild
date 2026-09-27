import { lstat, mkdir, realpath, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function installLink({ parentDir, extensionPath }) {
  const source = await realpath(extensionPath);
  const target = join(parentDir, '.omp', 'extensions', 'codex-qc.ts');
  await mkdir(dirname(target), { recursive: true });

  let existing;
  try {
    existing = await lstat(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing) {
    if (existing.isSymbolicLink() && await realpath(target).catch(() => undefined) === source) return target;
    throw new Error(`${target} already exists and points elsewhere`);
  }
  await symlink(source, target);
  return target;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const repoDir = resolve(dirname(scriptPath), '../..');
  const parentDir = dirname(repoDir);
  const extensionPath = join(repoDir, '.omp', 'extensions', 'codex-qc.ts');
  installLink({ parentDir, extensionPath }).then((target) => {
    console.log(`${target} -> ${extensionPath}`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
