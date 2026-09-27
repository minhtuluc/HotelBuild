import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQcLoop } from '../../scripts/agent-qc/loop.mjs';

type ReportEntry = { status: string; summary: string; round: number; findings?: unknown[] };
type AgentContext = { agent: { kind: string }; ui: { notify: (message: string, level: 'info' | 'warning') => void } };
type StopEvent = { signal?: AbortSignal; stop_hook_active?: boolean };
type Handler = (event: StopEvent, ctx: AgentContext) => Promise<unknown> | void;
type ExtensionApi = { on: (event: string, handler: Handler) => void };
type LoopOptions = Parameters<typeof createQcLoop>[0];
type QcOptions = { repoDir?: string; capture?: LoopOptions['capture']; review?: LoopOptions['review']; report?: (entry: ReportEntry) => void };

export function repoDirFromExtension() {
  return resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), '../..');
}

export function writeQcReport(repoDir: string, entry: ReportEntry) {
  const reportDir = join(repoDir, '.agent-qc');
  mkdirSync(reportDir, { recursive: true });
  appendFileSync(join(reportDir, 'reviews.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

export function registerQcExtension(pi: ExtensionApi, { repoDir, capture, review, report }: QcOptions = {}) {
  const selectedRepoDir = repoDir ?? repoDirFromExtension();
  let ui: AgentContext['ui'] | undefined;
  // The JavaScript loop's default callback is inferred as zero-argument by TypeScript.
  // @ts-expect-error The loop calls report(entry) for every review outcome.
  const qc = createQcLoop({ repoDir: selectedRepoDir, capture, review, report: (entry: ReportEntry) => {
    (report ?? ((result: ReportEntry) => writeQcReport(selectedRepoDir, result)))(entry);
    if (entry.status === 'PASS' || entry.status === 'BLOCKED') {
      ui?.notify(`Codex QC ${entry.status}: ${entry.summary}`, entry.status === 'PASS' ? 'info' : 'warning');
    }
  } });

  pi.on('before_agent_start', async (_event, ctx) => {
    if (ctx.agent.kind !== 'main') return;
    ui = ctx.ui;
    await qc.begin();
  });
  pi.on('session_stop', async (event, ctx) => {
    if (ctx.agent.kind !== 'main') return;
    ui = ctx.ui;
    const outcome: unknown = await qc.stop({ signal: event.signal });
    return outcome;
  });
  pi.on('session_shutdown', (_event, ctx) => {
    if (ctx.agent.kind !== 'main') return;
    qc.cancel();
  });
  return qc;
}

export default function codexQcExtension(pi: ExtensionApi) {
  registerQcExtension(pi);
}
