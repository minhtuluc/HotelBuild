import { captureGitState, hasChanged } from './git-state.mjs';
import { runCodexReview } from './reviewer.mjs';

function formatFindings(findings) {
  return findings.filter((finding) => finding.severity === 'blocking')
    .map((finding) => `- ${finding.path}${finding.line === null ? '' : `:${finding.line}`}: ${finding.message}`)
    .join('\n');
}

export function createQcLoop({ repoDir, capture = captureGitState, review = runCodexReview, maxRounds = 3, report = () => {} }) {
  let task;
  let status = 'IDLE';

  function finish(currentTask, entry) {
    if (task !== currentTask) return;
    status = entry.status;
    currentTask.active = false;
    report(entry);
  }

  async function runStop(currentTask, signal) {
    if (!currentTask.active || task !== currentTask) return undefined;
    if (signal?.aborted || currentTask.controller.signal.aborted) {
      finish(currentTask, { status: 'BLOCKED', summary: 'QC cancelled', round: currentTask.rounds });
      return undefined;
    }

    let current;
    try {
      current = await capture(repoDir, currentTask.baseline.head);
      if (task !== currentTask) return undefined;
      if (signal?.aborted || currentTask.controller.signal.aborted) throw new Error('QC cancelled');
      if (!hasChanged(currentTask.baseline, current)) {
        if (currentTask.lastReviewedFingerprint) finish(currentTask, { status: 'BLOCKED', summary: 'No changes after blocking feedback', round: currentTask.rounds });
        else { currentTask.active = false; status = 'SKIPPED'; }
        return undefined;
      }
      if (current.fingerprint === currentTask.lastReviewedFingerprint) {
        finish(currentTask, { status: 'BLOCKED', summary: 'No changes after blocking feedback', round: currentTask.rounds });
        return undefined;
      }

      currentTask.rounds++;
      const onAbort = () => currentTask.controller.abort(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      let result;
      try {
        result = await review({ repoDir, baseSha: currentTask.baseline.head, changedPaths: current.changedPaths, signal: currentTask.controller.signal });
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
      if (task !== currentTask) return undefined;
      if (signal?.aborted || currentTask.controller.signal.aborted) throw new Error('QC cancelled');
      const after = await capture(repoDir, currentTask.baseline.head);
      if (task !== currentTask) return undefined;
      if (signal?.aborted || currentTask.controller.signal.aborted) throw new Error('QC cancelled');
      if (!hasChanged(current, after)) {
        if (result.status === 'NEEDS_CHANGES' && currentTask.rounds < maxRounds) {
          currentTask.lastReviewedFingerprint = current.fingerprint;
          report({ ...result, round: currentTask.rounds });
          return { continue: true, additionalContext: `Codex QC found blocking issues:\n${formatFindings(result.findings)}` };
        }
        if (result.status === 'PASS') finish(currentTask, { ...result, round: currentTask.rounds });
        else if (result.status === 'NEEDS_CHANGES') finish(currentTask, { status: 'BLOCKED', summary: `Reached ${maxRounds} review rounds with blocking findings`, findings: result.findings, review: result, round: currentTask.rounds });
        else finish(currentTask, { ...result, round: currentTask.rounds });
      } else {
        finish(currentTask, { status: 'BLOCKED', summary: 'Repository changed during review; result is stale', review: result, round: currentTask.rounds });
      }
    } catch (error) {
      finish(currentTask, { status: 'BLOCKED', summary: error instanceof Error ? error.message : String(error), round: currentTask.rounds });
    }
    return undefined;
  }

  return {
    async begin() {
      task?.controller.abort();
      const currentTask = { baseline: undefined, lastReviewedFingerprint: undefined, rounds: 0,
        controller: new AbortController(), active: false, inFlight: undefined };
      task = currentTask;
      currentTask.baseline = await capture(repoDir);
      if (task !== currentTask) return;
      currentTask.active = true;
      status = 'PENDING';
    },
    stop({ signal } = {}) {
      const currentTask = task;
      if (!currentTask) return Promise.resolve(undefined);
      if (currentTask.inFlight) return currentTask.inFlight;
      const pending = runStop(currentTask, signal);
      currentTask.inFlight = pending;
      void pending.finally(() => { if (currentTask.inFlight === pending) currentTask.inFlight = undefined; });
      return pending;
    },
    cancel() { task?.controller.abort(); },
    get status() { return status; },
  };
}
