'use client';
import type { ReactElement } from 'react';
import { CreateForm } from './create';
import { FilterForm } from './filter';
import { text } from './messages';
import type { FieldIssue } from './model';
import { box } from './parts';
import { CommandStatus, ReadBanner } from './status';
import { ExceptionTable } from './table';
import type { ControllerState, ExceptionController } from './controller';
import type { Actor } from './port';
import { useExceptions } from './use-exceptions';

function serverIssues(state: ControllerState): readonly FieldIssue[] {
  const { command } = state;
  return command.kind === 'failed' && command.failure.kind === 'validation'
    ? command.failure.issues
    : [];
}

function Workspace({
  state,
  controller,
  actor,
}: {
  state: ControllerState;
  controller: ExceptionController;
  actor: Actor;
}): ReactElement {
  const busy = state.command.kind === 'sending';
  const issues = serverIssues(state);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void controller.load()}
        style={{ minHeight: 44, justifySelf: 'start' }}
      >
        {text('reload')}
      </button>
      <FilterForm
        value={state.filter}
        properties={state.properties}
        busy={busy}
        onApply={(filter) => void controller.applyFilter(filter)}
      />
      <div aria-live="polite" data-testid="hb138-command">
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
      <CreateForm
        serverIssues={issues}
        busy={busy}
        onCreate={(draft) => void controller.submitCreate(draft)}
      />
      <ExceptionTable
        list={state.list}
        filter={state.filter}
        actor={actor}
        busy={busy}
        serverIssues={issues}
        onMore={() => void controller.loadMore()}
        onDecide={(id, kind, note, pin) =>
          void (kind === 'approve'
            ? controller.submitApprove(id, note, pin)
            : controller.submitReject(id, note, pin))
        }
      />
    </>
  );
}

export function PolicyExceptionsScreen(): ReactElement {
  const { state, controller } = useExceptions();
  const denied = state.phase === 'forbidden' || state.phase === 'expired';
  return (
    <section style={{ padding: 'var(--space-s6, 24px)', ...box, gap: 'var(--space-s4, 16px)' }}>
      <h1 style={{ margin: 0 }}>{text('title')}</h1>
      <p>{text('intro')}</p>
      <a href="/overbooking/cases">{text('back')}</a>
      {denied ? (
        <p role="alert">{text(state.phase === 'expired' ? 'expired' : 'forbidden')}</p>
      ) : null}
      {state.phase === 'forbidden' ? <p>{text('roleBlocked')}</p> : null}
      <ReadBanner state={state} />
      {!denied && controller !== null && state.actor !== null ? (
        <Workspace state={state} controller={controller} actor={state.actor} />
      ) : null}
    </section>
  );
}
