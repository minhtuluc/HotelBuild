'use client';
import type { ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatDateTimeVn } from '@pinehill/ui-web';
import { CandidatesTable, Ladder } from './candidates';
import { MovePanel } from './move';
import { OptionsPanel } from './options';
import { PlanPanel } from './plan';
import { text } from './messages';
import { canCreate, canPlan, type FieldIssue, type Params } from './model';
import { box } from './parts';
import { CommandStatus, ReadBanner } from './status';
import type { ControllerState, RelocationController } from './controller';
import { useRelocation } from './use-relocation';

function serverIssues(state: ControllerState): readonly FieldIssue[] {
  const { command } = state;
  return command.kind === 'failed' && command.failure.kind === 'validation'
    ? command.failure.issues
    : [];
}

function CaseHeader({ state }: { state: ControllerState }): ReactElement | null {
  const detail = state.detail;
  if (detail === null) return null;
  return (
    <section style={box} aria-labelledby="hb136-case-title" data-testid="hb136-case">
      <h2 id="hb136-case-title">{text('caseTitle')}</h2>
      <p>
        {text('caseLine', {
          date: detail.date,
          count: detail.shortageCount,
          deadline: formatDateTimeVn(detail.resolveDeadline),
          state: detail.overdue ? text('overdue') : text('inTime'),
        })}
      </p>
      <Ladder steps={detail.ladderPreview} />
    </section>
  );
}

function ManagerView({
  state,
  controller,
}: {
  state: ControllerState;
  controller: RelocationController;
}): ReactElement {
  const busy = state.command.kind === 'sending';
  return (
    <>
      <CaseHeader state={state} />
      <PlanPanel
        plan={state.plan}
        busy={busy}
        onPlan={(strategy) => void controller.submitPlan(strategy)}
      />
      <CandidatesTable rows={state.plan?.candidates ?? state.detail?.candidates ?? []} />
    </>
  );
}

function DeskView({
  state,
  controller,
  params,
}: {
  state: ControllerState;
  controller: RelocationController;
  params: Params;
}): ReactElement | null {
  if (state.options === null) return null;
  return (
    <OptionsPanel
      options={state.options}
      bookingRoomId={params.bookingRoomId}
      serverIssues={serverIssues(state)}
      busy={state.command.kind === 'sending'}
      onCreate={(draft) => void controller.submitCreate(draft)}
    />
  );
}

function Workspace({
  state,
  controller,
  params,
}: {
  state: ControllerState;
  controller: RelocationController;
  params: Params;
}): ReactElement {
  const role = state.actor?.role;
  return (
    <>
      <button
        type="button"
        disabled={state.command.kind === 'sending'}
        onClick={() => void controller.load()}
        style={{ minHeight: 44, justifySelf: 'start' }}
      >
        {text('reload')}
      </button>
      <div aria-live="polite" data-testid="hb136-command">
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
      {role !== undefined && canPlan(role) ? (
        <ManagerView state={state} controller={controller} />
      ) : null}
      {role !== undefined && canCreate(role) ? (
        <DeskView state={state} controller={controller} params={params} />
      ) : null}
      {state.move === null || role === undefined ? null : (
        <MovePanel
          move={state.move}
          role={role}
          busy={state.command.kind === 'sending'}
          serverIssues={serverIssues(state)}
          onApprove={(draft, pin) => void controller.submitApprove(draft, pin)}
          onExecute={(pin) => void controller.submitExecute(pin)}
        />
      )}
    </>
  );
}

function paramsOf(search: { get(name: string): string | null }): Params {
  return {
    caseId: search.get('caseId') ?? '',
    bookingId: search.get('bookingId') ?? '',
    bookingRoomId: search.get('bookingRoomId') ?? '',
    moveId: search.get('moveId') ?? '',
  };
}

function Notices({ state, params }: { state: ControllerState; params: Params }): ReactElement {
  const denied = state.phase === 'forbidden' || state.phase === 'expired';
  return (
    <>
      {params.caseId === '' ? <p role="alert">{text('noCase')}</p> : null}
      {denied ? (
        <p role="alert">{text(state.phase === 'expired' ? 'expired' : 'forbidden')}</p>
      ) : null}
      <ReadBanner state={state} />
    </>
  );
}

export function RelocationScreen(): ReactElement {
  const params = paramsOf(useSearchParams());
  const { state, controller } = useRelocation(params);
  const ready =
    state.phase !== 'forbidden' &&
    state.phase !== 'expired' &&
    params.caseId !== '' &&
    state.actor !== null;
  return (
    <section style={{ padding: 'var(--space-s6, 24px)', ...box, gap: 'var(--space-s4, 16px)' }}>
      <h1 style={{ margin: 0 }}>{text('title')}</h1>
      <p>{text('intro')}</p>
      <a href="/overbooking/cases">{text('back')}</a>
      <Notices state={state} params={params} />
      {ready && controller !== null ? (
        <Workspace state={state} controller={controller} params={params} />
      ) : null}
    </section>
  );
}
