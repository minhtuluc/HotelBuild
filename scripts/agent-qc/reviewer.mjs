import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_OUTPUT_BYTES = 1_000_000;
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'review.schema.json');

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validateReview(value) {
  if (!hasExactKeys(value, ['status', 'summary', 'findings'])) throw new Error('Malformed review result');
  if (!['PASS', 'NEEDS_CHANGES', 'BLOCKED'].includes(value.status)) throw new Error('Invalid review status');
  if (typeof value.summary !== 'string' || !value.summary.trim()) throw new Error('Review summary is required');
  if (!Array.isArray(value.findings)) throw new Error('Review findings must be an array');

  for (const finding of value.findings) {
    if (!hasExactKeys(finding, ['path', 'line', 'severity', 'message'])) throw new Error('Malformed review finding');
    if (typeof finding.path !== 'string' || !finding.path.trim()) throw new Error('Review finding path is required');
    if (finding.line !== null && (!Number.isInteger(finding.line) || finding.line < 1)) throw new Error('Invalid review finding line');
    if (!['blocking', 'suggestion'].includes(finding.severity)) throw new Error('Invalid review finding severity');
    if (typeof finding.message !== 'string' || !finding.message.trim()) throw new Error('Review finding message is required');
  }

  const hasBlocking = value.findings.some((finding) => finding.severity === 'blocking');
  if (value.status === 'PASS' && hasBlocking) throw new Error('PASS cannot have blocking findings');
  if (value.status === 'NEEDS_CHANGES' && !hasBlocking) throw new Error('NEEDS_CHANGES requires a blocking finding');
  return value;
}

function reviewPrompt(baseSha, changedPaths) {
  return `Review the repository changes against base commit ${baseSha}, including current working-tree and untracked changes. Focus on defects that would prevent accepting the work. Changed paths: ${JSON.stringify(changedPaths)}. Return a JSON result matching the schema. Use PASS only when there are no blocking findings. Use NEEDS_CHANGES when there is at least one blocking finding. Use BLOCKED, with an actionable summary, if the review cannot be completed. Give each finding a repository-relative path, line number or null, severity, and clear message.`;
}

async function runProcess(codexBin, args, repoDir, signal, timeoutMs) {
  const child = spawn(codexBin, args, { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'], signal });
  let outputBytes = 0;
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill('SIGKILL');
        child.stdout.destroy();
        child.stderr.destroy();
        reject(error);
      } else {
        resolve();
      }
    };
    const onData = (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) finish(new Error('Codex process output too large'));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', finish);
    child.once('close', (code) => finish(code === 0 ? null : new Error(`Codex review exited with code ${code}`)));
    const timer = setTimeout(() => finish(new Error('Codex review timed out')), timeoutMs);
  });
}

export async function runCodexReview({ repoDir, baseSha, changedPaths, signal, codexBin = 'codex', timeoutMs = 600_000 }) {
  const outputDir = await mkdtemp(join(tmpdir(), 'agent-qc-codex-'));
  const resultPath = join(outputDir, 'review.json');
  try {
    const args = ['exec', '-C', repoDir, '--sandbox', 'read-only', '--output-schema', schemaPath, '-o', resultPath, reviewPrompt(baseSha, changedPaths)];
    await runProcess(codexBin, args, repoDir, signal, timeoutMs);
    const resultStat = await stat(resultPath);
    if (resultStat.size > MAX_OUTPUT_BYTES) throw new Error('Codex review output too large');
    let result;
    try {
      result = JSON.parse(await readFile(resultPath, 'utf8'));
    } catch (error) {
      throw new Error('Malformed Codex review JSON', { cause: error });
    }
    const review = validateReview(result);
    if (signal?.aborted) throw signal.reason ?? new DOMException('Review aborted', 'AbortError');
    return review;
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}
