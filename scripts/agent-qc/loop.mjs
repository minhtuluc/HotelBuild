import { captureGitState, hasChanged } from './git-state.mjs';
import { runCodexReview } from './reviewer.mjs';

function formatFindings(findings) {
  return findings.filter((finding) => finding.severity === 'blocking')
    .map((finding) => `- ${finding.path}${finding.line === null ? '' : `:${finding.line}`}: ${finding.message}`)
    .join('\n');
}

export function createQcLoop({ repoDir, capture = captureGitState, review = runCodexReview, maxRounds = 3, report = () => {} }) {
  let baseline;
  let lastReviewedFingerprint;
  let rounds = 0;
  let controller;
  let active = false;
  let inFlight;
  let status = 'IDLE';

  function finish(entry) {
    status = entry.status;
    active = false;
    report(entry);
  }

  async function runStop(signal) {
    if (!active) return undefined;
    if (signal?.aborted || controller.signal.aborted) {
      finish({ status: 'BLOCKED', summary: 'QC cancelled', round: rounds });
      return undefined;
    }

    let current;
    try {
      current = await capture(repoDir, baseline.head);
      if (signal?.aborted || controller.signal.aborted) throw new Error('QC cancelled');
      if (!hasChanged(baseline, current)) {
        if (lastReviewedFingerprint) finish({ status: 'BLOCKED', summary: 'No changes after blocking feedback', round: rounds });
        else { active = false; status = 'SKIPPED'; }
        return undefined;
      }
      if (current.fingerprint === lastReviewedFingerprint) {
        finish({ status: 'BLOCKED', summary: 'No changes after blocking feedback', round: rounds });
        return undefined;
      }

      rounds++;
      const onAbort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      let result;
      try {
        result = await review({ repoDir, baseSha: baseline.head, changedPaths: current.changedPaths, signal: controller.signal });
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
      if (signal?.aborted || controller.signal.aborted) throw new Error('QC cancelled');
      const after = await capture(repoDir, baseline.head);
      if (signal?.aborted || controller.signal.aborted) throw new Error('QC cancelled');
      if (!hasChanged(current, after)) {
        if (result.status === 'NEEDS_CHANGES' && rounds < maxRounds) {
          lastReviewedFingerprint = current.fingerprint;
          report({ ...result, round: rounds });
          return { continue: true, additionalContext: `Codex QC found blocking issues:\n${formatFindings(result.findings)}` };
        }
        if (result.status === 'PASS') finish({ ...result, round: rounds });
        else if (result.status === 'NEEDS_CHANGES') finish({ status: 'BLOCKED', summary: `Reached ${maxRounds} review rounds with blocking findings`, findings: result.findings, review: result, round: rounds });
        else finish({ ...result, round: rounds });
      } else {
        finish({ status: 'BLOCKED', summary: 'Repository changed during review; result is stale', review: result, round: rounds });
      }
    } catch (error) {
      finish({ status: 'BLOCKED', summary: error instanceof Error ? error.message : String(error), round: rounds });
    }
    return undefined;
  }

  return {
    async begin() {
      controller?.abort();
      baseline = await capture(repoDir);
      lastReviewedFingerprint = undefined;
      rounds = 0;
      controller = new AbortController();
      active = true;
      status = 'PENDING';
    },
    stop({ signal } = {}) {
      if (inFlight) return inFlight;
      const pending = runStop(signal);
      inFlight = pending;
      void pending.finally(() => { if (inFlight === pending) inFlight = undefined; });
      return pending;
    },
    cancel() { controller?.abort(); },
    get status() { return status; },
  };
}
