# OMP Codex QC Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically review OMP's changes to `OOAD` with Codex and return blocking findings to the same OMP task until it passes or stops safely.

**Architecture:** A project OMP extension handles `session_stop`; a small Node module snapshots Git state and invokes `codex exec` with a strict JSON result. A one-time installer links the tracked extension into `BUILDHOTEL/.omp/extensions`, matching the user's OMP launch directory.

**Tech Stack:** OMP v18.3.3 extension API, Codex CLI, Node.js v22.23.1, `node:test`, Git.

**Spec:** `docs/superpowers/specs/2026-09-27-omp-codex-qc-loop-design.md`

## Global Constraints

- OMP starts with `cwd=BUILDHOTEL`; Git root is `BUILDHOTEL/OOAD`.
- Only OMP may edit the project during a task. Codex runs with `--sandbox read-only`.
- At most three Codex review rounds per user task; never treat CLI exit 0 alone as `PASS`.
- No automatic commit, merge, push, or deployment.
- Stop and show `BLOCKED` on invalid result, timeout, cancellation, stale diff, or repeated unchanged finding.

## File map

| File | Responsibility |
| --- | --- |
| `scripts/agent-qc/git-state.mjs` | Capture and fingerprint committed, tracked, and untracked repo changes |
| `scripts/agent-qc/review.schema.json` | Strict Codex result contract |
| `scripts/agent-qc/reviewer.mjs` | Run Codex read-only, bound time/output, parse and validate result |
| `scripts/agent-qc/loop.mjs` | Decide skip, continue, pass, or block for one OMP task |
| `.omp/extensions/codex-qc.ts` | Adapt OMP events to the loop and show status |
| `scripts/agent-qc/install.mjs` | Idempotently link the tracked extension into `BUILDHOTEL/.omp/extensions` |
| `tests/agent-qc.test.mjs` | Exercise Git snapshots, reviewer, loop and installer without live model calls |
| `.gitignore`, `package.json`, `docs/07-ban-giao/omp-codex-qc.md` | Ignore logs, include test, explain setup and stop states |

### Task 1: Git snapshot detects task changes

**Files:** Create `scripts/agent-qc/git-state.mjs`; create `tests/agent-qc.test.mjs`.

**Interfaces:** `captureGitState(repoDir, baseSha?) -> Promise<{ head: string, fingerprint: string, changedPaths: string[] }>`; `baseSha` defaults to current `HEAD`. Export `hasChanged(before, after) -> boolean`.

- [ ] **Step 1: Write a failing test using a temporary Git repo.**

```js
test('snapshot changes for tracked edits, untracked bytes, and new commits', async () => {
  const repo = await createTemporaryGitRepo();
  const before = await captureGitState(repo);
  await writeFile(join(repo, 'tracked.txt'), 'changed');
  const edited = await captureGitState(repo, before.head);
  assert.equal(hasChanged(before, edited), true);
  await writeFile(join(repo, 'new.txt'), 'one');
  const untracked = await captureGitState(repo, before.head);
  assert.notEqual(untracked.fingerprint, edited.fingerprint);
  await commitAll(repo, 'change');
  const committed = await captureGitState(repo, before.head);
  assert.equal(hasChanged(before, committed), true);
});
```

- [ ] **Step 2: Run** `node --test tests/agent-qc.test.mjs`; confirm the import or behavior fails because `git-state.mjs` is absent.
- [ ] **Step 3: Implement `captureGitState` with `git rev-parse HEAD`, `git diff --binary <baseSha>`, and `git ls-files --others --exclude-standard -z`; hash untracked file paths and bytes. Never include ignored logs.**

```js
export async function captureGitState(repoDir, baseSha) {
  const head = (await git(repoDir, ['rev-parse', 'HEAD'])).trim();
  const diff = await git(repoDir, ['diff', '--binary', baseSha ?? head]);
  const untracked = await listUntrackedWithHashes(repoDir);
  return { head, fingerprint: sha256(head + diff + untracked.serialized), changedPaths: await changedPaths(repoDir, baseSha ?? head) };
}
export const hasChanged = (before, after) => before.fingerprint !== after.fingerprint;
```

- [ ] **Step 4: Run** `node --test tests/agent-qc.test.mjs`; confirm all snapshot tests pass.
- [ ] **Step 5: Commit** `git-state.mjs` and its tests.

### Task 2: Codex client returns a trusted result

**Files:** Create `scripts/agent-qc/review.schema.json`, `scripts/agent-qc/reviewer.mjs`; extend `tests/agent-qc.test.mjs`.

**Interfaces:** `runCodexReview({ repoDir, baseSha, changedPaths, signal, codexBin = 'codex', timeoutMs = 600000 }) -> Promise<{ status: 'PASS'|'NEEDS_CHANGES'|'BLOCKED', summary: string, findings: Array<{ path: string, line: number|null, severity: 'blocking'|'suggestion', message: string }> }>`; throw on CLI failure, timeout, oversized output, malformed JSON, or inconsistent status/findings.

- [ ] **Step 1: Add failing tests with a fake Codex executable that writes to the `-o` path; assert `PASS` needs zero blocking findings and malformed JSON/exit failure is rejected.**

```js
test('reviewer rejects an invalid PASS', async () => {
  const codexBin = await fakeCodexWriting({ status: 'PASS', summary: 'ok', findings: [{ path: 'x', line: 1, severity: 'blocking', message: 'bug' }] });
  await assert.rejects(runCodexReview({ repoDir, baseSha, changedPaths: ['x'], codexBin }), /blocking findings/);
});
```

- [ ] **Step 2: Run** `node --test tests/agent-qc.test.mjs`; confirm reviewer tests fail because the module is absent.
- [ ] **Step 3: Add the JSON schema and spawn `codex exec -C <repo> --sandbox read-only --output-schema <schema> -o <temporary-output> <prompt>`. Bound elapsed time and stdout/stderr bytes; parse the output file; validate all fields and status consistency; remove temporary output in `finally`.**

```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string", "enum": ["PASS", "NEEDS_CHANGES", "BLOCKED"] },
    "summary": { "type": "string" },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "line": { "type": ["integer", "null"] },
          "severity": { "type": "string", "enum": ["blocking", "suggestion"] },
          "message": { "type": "string" }
        },
        "required": ["path", "line", "severity", "message"],
        "additionalProperties": false
      }
    }
  },
  "required": ["status", "summary", "findings"],
  "additionalProperties": false
}
```

```js
const args = ['exec', '-C', repoDir, '--sandbox', 'read-only', '--output-schema', schemaPath, '-o', resultPath, prompt];
const child = spawn(codexBin, args, { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'], signal });
```

- [ ] **Step 4: Run** `node --test tests/agent-qc.test.mjs`; confirm success, malformed-output, nonzero-exit and timeout cases pass.
- [ ] **Step 5: Commit** schema, reviewer and tests.

### Task 3: Loop routes feedback and stops predictably

**Files:** Create `scripts/agent-qc/loop.mjs`; extend `tests/agent-qc.test.mjs`.

**Interfaces:** `createQcLoop({ repoDir, capture = captureGitState, review = runCodexReview, maxRounds = 3, report })` returns `{ begin(), stop({ signal }), cancel(), status }`; `stop` returns `undefined` for normal stop or `{ continue: true, additionalContext: string }` for OMP continuation. `report(entry)` records every review outcome, including errors.

- [ ] **Step 1: Add failing tests for no Git change, blocking feedback, PASS, three-round cap, unchanged diff after feedback, stale diff after review, and reviewer error.**

```js
test('blocking feedback continues OMP and an unchanged next stop blocks', async () => {
  const qc = createQcLoop({ repoDir, capture: nextSnapshots(before, changed, changed), review: async () => blockingReview, report: collectReports() });
  await qc.begin();
  assert.match((await qc.stop({})).additionalContext, /blocking issue/);
  assert.equal(await qc.stop({}), undefined);
  assert.equal(qc.status, 'BLOCKED');
});
```

- [ ] **Step 2: Run** `node --test tests/agent-qc.test.mjs`; confirm missing `loop.mjs` fails.
- [ ] **Step 3: Implement one active task state with baseline snapshot, last reviewed fingerprint, round count, abort controller, and report callback. Compare a snapshot again after Codex returns before accepting its result. Reset state only when the task ends or the next user task begins.**

```js
if (result.status === 'NEEDS_CHANGES' && rounds < maxRounds) {
  lastReviewedFingerprint = current.fingerprint;
  return { continue: true, additionalContext: formatFindings(result.findings) };
}
```

- [ ] **Step 4: Run** `node --test tests/agent-qc.test.mjs`; confirm every stop path passes.
- [ ] **Step 5: Commit** loop and tests.

### Task 4: OMP extension and shared-folder installation

**Files:** Create `.omp/extensions/codex-qc.ts`, `scripts/agent-qc/install.mjs`, `docs/07-ban-giao/omp-codex-qc.md`; modify `.gitignore`, `package.json`; extend `tests/agent-qc.test.mjs`.

**Interfaces:** `registerQcExtension(pi, { repoDir, capture, review, report })` registers OMP handlers and is tested with injected dependencies; the default factory supplies real dependencies. `installLink({ parentDir, extensionPath })` creates or confirms a symlink and refuses to overwrite another file. The module's real path determines the `OOAD` Git root, regardless of OMP's `cwd`.

- [ ] **Step 1: Add failing tests for event registration and install idempotence/conflict. Use a fake `pi.on` registry and a temporary parent directory; assert `session_stop` returns the loop continuation.**

```js
test('installer links from parent OMP directory without replacing another file', async () => {
  const target = await installLink({ parentDir, extensionPath });
  assert.equal(await realpath(target), await realpath(extensionPath));
  assert.equal(await installLink({ parentDir, extensionPath }), target);
  await assert.rejects(installLink({ parentDir: conflictingParent, extensionPath }), /already exists/);
});
```

- [ ] **Step 2: Run** `node --test tests/agent-qc.test.mjs`; confirm the extension/installer imports or assertions fail.
- [ ] **Step 3: Register `before_agent_start`, `session_stop`, and `session_shutdown`; ignore subagents; show PASS/BLOCKED through OMP UI; use the tracked extension's location to choose `OOAD`. Handle `session_stop` again after a continuation even when `event.stop_hook_active` is true. Write one JSONL report per round under `OOAD/.agent-qc/` and ignore that directory in Git. Install the symlink under `BUILDHOTEL/.omp/extensions` and refuse to replace existing files. Include the test in `test:tooling`, and document one-time setup and `/reload` or restart.**

```ts
pi.on('session_stop', async (event, ctx) => {
  if (ctx.agent.kind !== 'main') return;
  return qc.stop({ signal: event.signal });
});
```

- [ ] **Step 4: Run** `node --test tests/agent-qc.test.mjs`, `npm run test:tooling`, `npm run lint`, and `git diff --check`; fix only failures caused by this task.
- [ ] **Step 5: Run the installer and confirm `BUILDHOTEL/.omp/extensions/codex-qc.ts` resolves to the tracked source. Smoke-test OMP loading without a model request if CLI state permits. Commit tracked code, tests, configuration and guide.**

## Final verification

- [ ] Confirm `git status --short` contains no accidental logs or model output.
- [ ] Run `npm run test:tooling`, `npm run lint`, and `git diff --check` against the finished branch.
- [ ] Review the actual diff with one reviewer before integration; inspect every blocking finding and retest any fix.
- [ ] Confirm the installed link and provide the exact OMP reload/restart step to the user.
