import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { captureGitState, hasChanged } from '../scripts/agent-qc/git-state.mjs';
import { runCodexReview } from '../scripts/agent-qc/reviewer.mjs';
import { createQcLoop } from '../scripts/agent-qc/loop.mjs';
import { installLink } from '../scripts/agent-qc/install.mjs';
import { registerQcExtension, repoDirFromExtension, writeQcReport } from '../.omp/extensions/codex-qc.ts';

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

test('untracked file boundaries cannot produce the same fingerprint', async () => {
  await withRepo(async (repo) => {
    await writeFile(join(repo, 'a'), 'x');
    await writeFile(join(repo, 'b'), 'y\0b\0z');
    const first = await captureGitState(repo);

    await writeFile(join(repo, 'a'), 'x\0b\0y');
    await writeFile(join(repo, 'b'), 'z');
    const second = await captureGitState(repo);

    assert.deepEqual(first.changedPaths, second.changedPaths);
    assert.notEqual(first.fingerprint, second.fingerprint);
  });
});

test('untracked symlinks hash link text, including broken targets', async () => {
  await withRepo(async (repo) => {
    await writeFile(join(repo, 'target.log'), 'one');
    await symlink('target.log', join(repo, 'pointer'));
    const first = await captureGitState(repo);
    assert.deepEqual(first.changedPaths, ['pointer']);

    await writeFile(join(repo, 'target.log'), 'two');
    const changedTarget = await captureGitState(repo);
    assert.equal(changedTarget.fingerprint, first.fingerprint);

    await unlink(join(repo, 'pointer'));
    await symlink('missing.log', join(repo, 'pointer'));
    const brokenTarget = await captureGitState(repo);
    assert.notEqual(brokenTarget.fingerprint, first.fingerprint);
    assert.deepEqual(brokenTarget.changedPaths, ['pointer']);
  });
});

async function withFakeCodex({ output, exitCode = 0, delayMs = 0, stdout = '', inheritedPipeMs = 0 }, run) {
  const repoDir = await mkdtemp(join(tmpdir(), 'agent-qc-review-'));
  const codexBin = join(repoDir, 'fake-codex');
  const argsPath = join(repoDir, 'args.json');
  const donePath = join(repoDir, 'done');
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(args));
if (${inheritedPipeMs} > 0) spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${inheritedPipeMs})'], { stdio: ['ignore', 'inherit', 'inherit'] });
setTimeout(() => {
  const outputPath = args[args.indexOf('-o') + 1];
  fs.writeFileSync(outputPath, ${JSON.stringify(output)});
  if (${stdout.length} > 0) fs.writeSync(1, ${JSON.stringify(stdout)});
  fs.writeFileSync(${JSON.stringify(donePath)}, 'done');
  process.exit(${exitCode});
}, ${delayMs});
`;
  try {
    await writeFile(codexBin, script);
    await chmod(codexBin, 0o755);
    await run({ repoDir, codexBin, argsPath, donePath });
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

const baseSha = 'a'.repeat(40);
const passReview = { status: 'PASS', summary: 'No issues found', findings: [] };

test('reviewer invokes read-only Codex and returns a valid PASS', async () => {
  await withFakeCodex({ output: JSON.stringify(passReview) }, async ({ repoDir, codexBin, argsPath }) => {
    const result = await runCodexReview({ repoDir, baseSha, changedPaths: ['src/a.js'], codexBin });
    assert.deepEqual(result, passReview);
    const args = JSON.parse(await readFile(argsPath, 'utf8'));
    assert.deepEqual(args.slice(0, 5), ['exec', '-C', repoDir, '--sandbox', 'read-only']);
    assert.equal(args[5], '--output-schema');
    assert.equal(args[7], '-o');
    assert.match(args[9], /src\/a\.js/);
    assert.match(args[9], new RegExp(baseSha));
  });
});

test('reviewer rejects PASS with a blocking finding', async () => {
  const output = JSON.stringify({ status: 'PASS', summary: 'ok', findings: [{ path: 'x', line: 1, severity: 'blocking', message: 'bug' }] });
  await withFakeCodex({ output }, async ({ repoDir, codexBin }) => {
    await assert.rejects(runCodexReview({ repoDir, baseSha, changedPaths: ['x'], codexBin }), /blocking findings/);
  });
});

test('reviewer rejects NEEDS_CHANGES without a blocking finding', async () => {
  const output = JSON.stringify({ status: 'NEEDS_CHANGES', summary: 'suggestion only', findings: [{ path: 'x', line: null, severity: 'suggestion', message: 'style' }] });
  await withFakeCodex({ output }, async ({ repoDir, codexBin }) => {
    await assert.rejects(runCodexReview({ repoDir, baseSha, changedPaths: ['x'], codexBin }), /blocking finding/);
  });
});

test('reviewer rejects malformed JSON and invalid fields', async () => {
  for (const output of ['{', JSON.stringify({ status: 'BLOCKED', summary: '', findings: [] }), JSON.stringify({ ...passReview, extra: true })]) {
    await withFakeCodex({ output }, async ({ repoDir, codexBin }) => {
      await assert.rejects(runCodexReview({ repoDir, baseSha, changedPaths: [], codexBin }));
    });
  }
});

test('reviewer rejects nonzero Codex exit', async () => {
  await withFakeCodex({ output: JSON.stringify(passReview), exitCode: 2 }, async ({ repoDir, codexBin }) => {
    await assert.rejects(runCodexReview({ repoDir, baseSha, changedPaths: [], codexBin }), /exit|code/i);
  });
});

test('reviewer times out a stalled Codex process', async () => {
  await withFakeCodex({ output: JSON.stringify(passReview), delayMs: 1000 }, async ({ repoDir, codexBin }) => {
    await assert.rejects(runCodexReview({ repoDir, baseSha, changedPaths: [], codexBin, timeoutMs: 50 }), /timed out/i);
  });
});

test('reviewer rejects oversized process output', async () => {
  await withFakeCodex({ output: JSON.stringify(passReview), stdout: 'x'.repeat(1_100_000) }, async ({ repoDir, codexBin }) => {
    await assert.rejects(runCodexReview({ repoDir, baseSha, changedPaths: [], codexBin }), /output.*large/i);
  });
});

async function rejectsBeforeInheritedPipeCloses(review, expected) {
  const outcome = await Promise.race([
    review.then(() => 'resolved', (error) => error),
    new Promise((resolve) => setTimeout(() => resolve('still pending'), 400)),
  ]);
  assert.match(String(outcome), expected);
}

test('reviewer timeout rejects while a descendant retains stdout', async () => {
  await withFakeCodex({ output: JSON.stringify(passReview), delayMs: 1000, inheritedPipeMs: 1000 }, async ({ repoDir, codexBin }) => {
    await rejectsBeforeInheritedPipeCloses(runCodexReview({ repoDir, baseSha, changedPaths: [], codexBin, timeoutMs: 150 }), /timed out/i);
  });
});

test('reviewer output limit rejects while a descendant retains stdout', async () => {
  await withFakeCodex({ output: JSON.stringify(passReview), stdout: 'x'.repeat(1_100_000), inheritedPipeMs: 1000 }, async ({ repoDir, codexBin }) => {
    await rejectsBeforeInheritedPipeCloses(runCodexReview({ repoDir, baseSha, changedPaths: [], codexBin }), /output.*large/i);
  });
});

test('reviewer rejects an aborted signal before returning a parsed PASS', async () => {
  await withFakeCodex({ output: JSON.stringify(passReview) }, async ({ repoDir, codexBin, donePath }) => {
    const controller = new AbortController();
    const signal = controller.signal;
    const originalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
    Object.defineProperty(signal, 'aborted', {
      get() {
        if (existsSync(donePath)) controller.abort();
        return originalAborted.call(this);
      },
    });
    await assert.rejects(runCodexReview({ repoDir, baseSha, changedPaths: [], codexBin, signal }), /abort/i);
  });
});

function snapshot(fingerprint, changedPaths = []) {
  return { head: baseSha, fingerprint, changedPaths };
}

function nextSnapshots(...snapshots) {
  let index = 0;
  return async () => snapshots[Math.min(index++, snapshots.length - 1)];
}

const blockingReview = {
  status: 'NEEDS_CHANGES',
  summary: 'Fix the blocking issue',
  findings: [{ path: 'src/a.js', line: 7, severity: 'blocking', message: 'blocking issue' }],
};

test('extension registers main-agent hooks and returns continuation on repeated stop', async () => {
  const handlers = new Map();
  const notifications = [];
  const reports = [];
  const pi = { on: (name, handler) => handlers.set(name, handler) };
  registerQcExtension(pi, { repoDir: '/repo', capture: nextSnapshots(snapshot('before'), snapshot('changed', ['src/a.js'])),
    review: async () => blockingReview, report: (entry) => reports.push(entry) });
  assert.deepEqual([...handlers.keys()], ['before_agent_start', 'session_stop', 'session_shutdown']);
  const ctx = { agent: { kind: 'main' }, ui: { notify: (...args) => notifications.push(args) } };
  await handlers.get('before_agent_start')({}, ctx);
  const continuation = await handlers.get('session_stop')({ stop_hook_active: false }, ctx);
  assert.equal(continuation.continue, true);
  assert.match(continuation.additionalContext, /blocking issue/);
  assert.equal(await handlers.get('session_stop')({ stop_hook_active: true }, ctx), undefined);
  assert.deepEqual(reports.map((entry) => entry.status), ['NEEDS_CHANGES', 'BLOCKED']);
  assert.match(notifications.at(-1)[0], /BLOCKED/);
});

test('extension retains a pending review across another start, then begins a fresh completed task', async () => {
  const handlers = new Map();
  const reports = [];
  let reviews = 0;
  registerQcExtension({ on: (name, handler) => handlers.set(name, handler) }, {
    repoDir: '/repo',
    capture: nextSnapshots(snapshot('before'), snapshot('changed', ['src/a.js']), snapshot('changed', ['src/a.js']),
      snapshot('changed', ['src/a.js']), snapshot('changed', ['src/a.js']),
      snapshot('newer', ['src/a.js']), snapshot('newer', ['src/a.js'])),
    review: async () => (++reviews === 1 ? blockingReview : passReview),
    report: (entry) => reports.push(entry),
  });
  const ctx = { agent: { kind: 'main' }, ui: { notify: () => {} } };
  await handlers.get('before_agent_start')({}, ctx);
  assert.equal((await handlers.get('session_stop')({}, ctx)).continue, true);
  await handlers.get('before_agent_start')({}, ctx);
  assert.equal(await handlers.get('session_stop')({ stop_hook_active: true }, ctx), undefined);
  assert.deepEqual(reports.map((entry) => entry.status), ['NEEDS_CHANGES', 'BLOCKED']);
  await handlers.get('before_agent_start')({}, ctx);
  assert.equal(await handlers.get('session_stop')({}, ctx), undefined);
  assert.deepEqual(reports.map((entry) => entry.status), ['NEEDS_CHANGES', 'BLOCKED', 'PASS']);
});

test('extension ignores subagents and shows PASS for a reviewed main task', async () => {
  const handlers = new Map();
  const notifications = [];
  let captures = 0;
  registerQcExtension({ on: (name, handler) => handlers.set(name, handler) }, {
    repoDir: '/repo', capture: async () => { captures++; return captures === 1 ? snapshot('before') : snapshot('changed', ['src/a.js']); },
    review: async () => passReview, report: () => {},
  });
  const subagent = { agent: { kind: 'subagent' }, ui: { notify: (...args) => notifications.push(args) } };
  await handlers.get('before_agent_start')({}, subagent);
  await handlers.get('session_stop')({}, subagent);
  await handlers.get('session_shutdown')({}, subagent);
  assert.equal(captures, 0);
  const main = { agent: { kind: 'main' }, ui: subagent.ui };
  await handlers.get('before_agent_start')({}, main);
  await handlers.get('session_stop')({}, main);
  assert.match(notifications.at(-1)[0], /PASS/);
});

test('extension source resolves its OOAD repository independent of process cwd', async () => {
  assert.equal(await realpath(repoDirFromExtension()), await realpath(fileURLToPath(new URL('..', import.meta.url))));
});

test('each review round appends one JSONL report in the repository', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'agent-qc-report-'));
  try {
    writeQcReport(repo, { status: 'NEEDS_CHANGES', round: 1, summary: 'fix', findings: [] });
    writeQcReport(repo, { status: 'PASS', round: 2, summary: 'clear', findings: [] });
    const lines = (await readFile(join(repo, '.agent-qc', 'reviews.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((line) => JSON.parse(line).status), ['NEEDS_CHANGES', 'PASS']);
    assert.deepEqual(lines.map((line) => JSON.parse(line).round), [1, 2]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('installer links from parent OMP directory without replacing another file', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agent-qc-install-'));
  const parentDir = join(temp, 'parent');
  const conflictingParent = join(temp, 'conflict');
  // fileURLToPath giải mã %20 — URL.pathname làm hỏng đường dẫn có dấu cách/ký tự Unicode.
  const extensionPath = fileURLToPath(new URL('../.omp/extensions/codex-qc.ts', import.meta.url));
  try {
    await mkdir(parentDir);
    await mkdir(join(conflictingParent, '.omp', 'extensions'), { recursive: true });
    const target = await installLink({ parentDir, extensionPath });
    assert.equal(await realpath(target), await realpath(extensionPath));
    assert.equal(await installLink({ parentDir, extensionPath }), target);
    await writeFile(join(conflictingParent, '.omp', 'extensions', 'codex-qc.ts'), 'other');
    await assert.rejects(installLink({ parentDir: conflictingParent, extensionPath }), /already exists/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('unchanged task skips review', async () => {
  let calls = 0;
  const entries = [];
  const qc = createQcLoop({ repoDir: '/repo', capture: nextSnapshots(snapshot('before'), snapshot('before')),
    review: async () => { calls++; return passReview; }, report: (entry) => entries.push(entry) });
  await qc.begin();
  assert.equal(await qc.stop({}), undefined);
  assert.equal(calls, 0);
  assert.deepEqual(entries, []);
});

test('blocking feedback continues OMP and an unchanged next stop blocks', async () => {
  const entries = [];
  const qc = createQcLoop({ repoDir: '/repo', capture: nextSnapshots(snapshot('before'), snapshot('changed', ['src/a.js'])),
    review: async () => blockingReview, report: (entry) => entries.push(entry) });
  await qc.begin();
  assert.match((await qc.stop({})).additionalContext, /blocking issue/);
  assert.equal(await qc.stop({}), undefined);
  assert.equal(qc.status, 'BLOCKED');
  assert.deepEqual(entries.map((entry) => entry.status), ['NEEDS_CHANGES', 'BLOCKED']);
});

test('PASS ends the task after reviewing the current diff', async () => {
  const entries = [];
  const qc = createQcLoop({ repoDir: '/repo', capture: nextSnapshots(snapshot('before'), snapshot('changed', ['src/a.js'])),
    review: async (options) => { assert.equal(options.baseSha, baseSha); assert.deepEqual(options.changedPaths, ['src/a.js']); return passReview; },
    report: (entry) => entries.push(entry) });
  await qc.begin();
  assert.equal(await qc.stop({}), undefined);
  assert.equal(qc.status, 'PASS');
  assert.equal(entries[0].status, 'PASS');
});

test('third blocking review reaches the round cap without another continuation', async () => {
  const entries = [];
  const qc = createQcLoop({ repoDir: '/repo', capture: nextSnapshots(snapshot('before'), snapshot('one', ['src/a.js']), snapshot('one', ['src/a.js']),
    snapshot('two', ['src/a.js']), snapshot('two', ['src/a.js']), snapshot('three', ['src/a.js']), snapshot('three', ['src/a.js'])),
    review: async () => blockingReview, report: (entry) => entries.push(entry) });
  await qc.begin();
  assert.equal((await qc.stop({})).continue, true);
  assert.equal((await qc.stop({})).continue, true);
  assert.equal(await qc.stop({}), undefined);
  assert.equal(qc.status, 'BLOCKED');
  assert.deepEqual(entries.map((entry) => entry.status), ['NEEDS_CHANGES', 'NEEDS_CHANGES', 'BLOCKED']);
});

test('diff changed during review is blocked rather than accepted', async () => {
  const entries = [];
  const qc = createQcLoop({ repoDir: '/repo', capture: nextSnapshots(snapshot('before'), snapshot('reviewed', ['src/a.js']), snapshot('newer', ['src/a.js'])),
    review: async () => passReview, report: (entry) => entries.push(entry) });
  await qc.begin();
  assert.equal(await qc.stop({}), undefined);
  assert.equal(qc.status, 'BLOCKED');
  assert.equal(entries[0].status, 'BLOCKED');
  assert.match(entries[0].summary, /changed|stale/i);
});

test('reviewer error blocks and is reported', async () => {
  const entries = [];
  const qc = createQcLoop({ repoDir: '/repo', capture: nextSnapshots(snapshot('before'), snapshot('changed', ['src/a.js'])),
    review: async () => { throw new Error('Codex unavailable'); }, report: (entry) => entries.push(entry) });
  await qc.begin();
  assert.equal(await qc.stop({}), undefined);
  assert.equal(qc.status, 'BLOCKED');
  assert.equal(entries[0].status, 'BLOCKED');
  assert.match(entries[0].summary, /Codex unavailable/);
});

test('cancellation during the post-review snapshot cannot accept PASS', async () => {
  const entries = [];
  let qc;
  let captures = 0;
  qc = createQcLoop({ repoDir: '/repo', capture: async () => {
    captures++;
    if (captures === 3) qc.cancel();
    return captures === 1 ? snapshot('before') : snapshot('changed', ['src/a.js']);
  }, review: async () => passReview, report: (entry) => entries.push(entry) });
  await qc.begin();
  assert.equal(await qc.stop({}), undefined);
  assert.equal(qc.status, 'BLOCKED');
  assert.match(entries[0].summary, /cancel/i);
});

test('a new task resets the previous blocking fingerprint', async () => {
  const entries = [];
  const qc = createQcLoop({ repoDir: '/repo', capture: nextSnapshots(snapshot('before'), snapshot('one', ['src/a.js']), snapshot('one', ['src/a.js']),
    snapshot('one'), snapshot('two', ['src/a.js']), snapshot('two', ['src/a.js'])),
    review: async () => blockingReview, report: (entry) => entries.push(entry) });
  await qc.begin();
  assert.equal((await qc.stop({})).continue, true);
  await qc.begin();
  assert.equal((await qc.stop({})).continue, true);
  assert.equal(qc.status, 'PENDING');
});

test('a new task reviews independently while an old stop is still pending', async () => {
  const entries = [];
  let releaseOldReview;
  let reviews = 0;
  const oldReview = new Promise((resolve) => { releaseOldReview = resolve; });
  const qc = createQcLoop({ repoDir: '/repo', capture: nextSnapshots(
    snapshot('before-one'), snapshot('changed-one', ['src/a.js']),
    snapshot('before-two'), snapshot('changed-two', ['src/b.js']), snapshot('changed-two', ['src/b.js'])),
  review: async () => (++reviews === 1 ? oldReview : passReview), report: (entry) => entries.push(entry) });

  await qc.begin();
  const oldStop = qc.stop({});
  await Promise.resolve();
  await qc.begin();
  const newStop = qc.stop({});
  releaseOldReview(blockingReview);
  assert.equal(await newStop, undefined);
  assert.equal(await oldStop, undefined);
  assert.equal(reviews, 2);
  assert.equal(qc.status, 'PASS');
  assert.deepEqual(entries.map((entry) => entry.status), ['PASS']);
});


test('failed baseline capture reports BLOCKED and a later stop settles', async () => {
  const handlers = new Map();
  const reports = [];
  const notifications = [];
  const qc = registerQcExtension({ on: (name, handler) => handlers.set(name, handler) }, {
    repoDir: '/repo', capture: async () => { throw new Error('git permission denied'); },
    report: (entry) => reports.push(entry),
  });
  const ctx = { agent: { kind: 'main' }, ui: { notify: (...args) => notifications.push(args) } };
  await handlers.get('before_agent_start')({}, ctx);
  assert.equal(await handlers.get('session_stop')({}, ctx), undefined);
  assert.equal(qc.status, 'BLOCKED');
  assert.deepEqual(reports.map((entry) => entry.status), ['BLOCKED']);
  assert.match(notifications.at(-1)[0], /BLOCKED.*baseline.*git permission denied/i);
  assert.equal(notifications.at(-1)[1], 'warning');
});

test('throwing reporter blocks without retrying or leaking an unhandled rejection', async () => {
  let reports = 0;
  const qc = createQcLoop({ repoDir: '/repo',
    capture: nextSnapshots(snapshot('before'), snapshot('changed', ['src/a.js'])),
    review: async () => passReview,
    report: () => { reports++; throw new Error('report unavailable'); },
  });
  await qc.begin();
  assert.equal(await qc.stop(), undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(qc.status, 'BLOCKED');
  assert.equal(reports, 1);
  assert.equal(await qc.stop(), undefined);
});

test('failed log write still notifies BLOCKED and settles the stop hook', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'agent-qc-log-failure-'));
  try {
    await writeFile(join(repo, '.agent-qc'), 'prevents log directory creation');
    const handlers = new Map();
    const notifications = [];
    const qc = registerQcExtension({ on: (name, handler) => handlers.set(name, handler) }, {
      repoDir: repo, capture: nextSnapshots(snapshot('before'), snapshot('changed', ['src/a.js'])),
      review: async () => passReview,
    });
    const ctx = { agent: { kind: 'main' }, ui: { notify: (...args) => notifications.push(args) } };
    await handlers.get('before_agent_start')({}, ctx);
    assert.equal(await handlers.get('session_stop')({}, ctx), undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(qc.status, 'BLOCKED');
    assert.equal(notifications.length, 1);
    assert.match(notifications[0][0], /BLOCKED.*report.*\.agent-qc/i);
    assert.equal(notifications[0][1], 'warning');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
