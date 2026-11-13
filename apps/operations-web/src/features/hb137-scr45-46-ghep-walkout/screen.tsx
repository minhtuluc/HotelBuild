'use client';
import type { ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_TITLE_STYLE,
  opsNoticeStyle,
} from '../../components/editorial-styles';
import { CreateMergeForm, MergePanel } from './merge';
import { text } from './messages';
import type { FieldIssue, Params } from './model';
import { CommandStatus, ReadBanner } from './status';
import type { ControllerState, WalkOutController } from './controller';
import { useWalkOut } from './use-walkout';
import { CompensationPanel, WalkOutPanel } from './walkout';

function serverIssues(state: ControllerState): readonly FieldIssue[] {
  const { command } = state;
  return command.kind === 'failed' && command.failure.kind === 'validation'
    ? command.failure.issues
    : [];
}

function Panels({
  state,
  controller,
}: {
  state: ControllerState;
  controller: WalkOutController;
}): ReactElement {
  const role = state.actor?.role;
  const busy = state.command.kind === 'sending';
  const issues = serverIssues(state);
  if (role === undefined) return <></>;
  return (
    <>
      <CreateMergeForm
        role={role}
        busy={busy}
        serverIssues={issues}
        onCreate={(draft) => void controller.submitMergeCreate(draft)}
      />
      {state.merge === null ? null : (
        <MergePanel
          merge={state.merge}
          role={role}
          busy={busy}
          serverIssues={issues}
          onConsent={(draft) => void controller.submitConsent(draft)}
          onApprove={(reason) => void controller.submitMergeApprove(reason)}
          onExecute={() => void controller.submitMergeExecute()}
        />
      )}
      {state.move === null ? null : (
        <>
          <WalkOutPanel
            move={state.move}
            role={role}
            busy={busy}
            serverIssues={issues}
            onApprove={(draft, pin) => void controller.submitMoveApprove(draft, pin)}
            onExecute={(pin) => void controller.submitMoveExecute(pin)}
          />
          <CompensationPanel
            move={state.move}
            payments={state.payments}
            role={role}
            busy={busy}
            serverIssues={issues}
            onPay={(draft, pin) => void controller.submitCompensate(draft, pin)}
          />
        </>
      )}
    </>
  );
}

function Workspace({
  state,
  controller,
}: {
  state: ControllerState;
  controller: WalkOutController;
}): ReactElement {
  return (
    <>
      <button
        type="button"
        className="ph-btn"
        disabled={state.command.kind === 'sending'}
        onClick={() => void controller.load()}
        style={{ minHeight: 44, justifySelf: 'start' }}
      >
        {text('reload')}
      </button>
      <div aria-live="polite" data-testid="hb137-command">
        <CommandStatus
          command={state.command}
          pending={state.pending}
          intentState={state.intentState}
          actions={{
            retry: () => void controller.retry(),
            lookup: () => void controller.lookup(),
            discard: () => controller.discardPending(),
          }}
        />
      </div>
      <Panels state={state} controller={controller} />
    </>
  );
}

function paramsOf(search: { get(name: string): string | null }): Params {
  return { mergeId: search.get('mergeId') ?? '', moveId: search.get('moveId') ?? '' };
}

export function MergeWalkOutScreen(): ReactElement {
  const params = paramsOf(useSearchParams());
  const { state, controller } = useWalkOut(params);
  const denied = state.phase === 'forbidden' || state.phase === 'expired';
  return (
    <section style={OPS_PAGE_STYLE}>
      <header style={OPS_HEADER_STYLE}>
        <h1 className="ph-display" style={OPS_TITLE_STYLE}>
          {text('title')}
        </h1>
        <p style={OPS_INTRO_STYLE}>{text('intro')}</p>
        <a href="/overbooking/cases" className="ph-btn" style={{ justifySelf: 'start' }}>
          {text('back')}
        </a>
      </header>
      {denied ? (
        <p role="alert" style={opsNoticeStyle('danger')}>
          {text(state.phase === 'expired' ? 'expired' : 'forbidden')}
        </p>
      ) : null}
      <ReadBanner state={state} />
      {!denied && controller !== null && state.actor !== null ? (
        <Workspace state={state} controller={controller} />
      ) : null}
    </section>
  );
}
