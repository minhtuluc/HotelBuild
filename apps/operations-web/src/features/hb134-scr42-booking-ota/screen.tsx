'use client';
import type { ReactElement } from 'react';
import { FilterForm } from './filter';
import { text } from './messages';
import { canFlag, type FieldIssue } from './model';
import { SelectInput, box } from './parts';
import { CommandStatus, ReadBanner } from './status';
import { OtaTable } from './table';
import type { ControllerState, OtaController } from './controller';
import { useOta } from './use-ota';

function serverIssues(state: ControllerState): readonly FieldIssue[] {
  const { command } = state;
  return command.kind === 'failed' && command.failure.kind === 'validation'
    ? command.failure.issues
    : [];
}

function Workspace({
  state,
  controller,
}: {
  state: ControllerState;
  controller: OtaController;
}): ReactElement {
  const role = state.actor?.role;
  const busy = state.command.kind === 'sending';
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
      <SelectInput
        name="channelId"
        label={text('channel')}
        value={state.channelId ?? ''}
        options={state.channels.map((channel) => ({ id: channel.id, label: channel.name }))}
        onChange={(id) => void controller.select(id)}
      />
      <FilterForm
        value={state.filter}
        busy={busy}
        onApply={(filter) => void controller.applyFilter(filter)}
      />
      <div aria-live="polite" data-testid="hb134-command">
        <CommandStatus
          command={state.command}
          pending={state.pending}
          actions={{
            retry: () => void controller.retry(),
            lookup: () => void controller.load(),
            discard: () => controller.discardPending(),
          }}
        />
      </div>
      <OtaTable
        list={state.list}
        canFlag={role !== undefined && canFlag(role)}
        busy={busy}
        serverIssues={serverIssues(state)}
        onMore={() => void controller.loadMore()}
        onFlag={(id, draft) => void controller.submitFlag(id, draft)}
      />
    </>
  );
}

export function OtaBookingsScreen(): ReactElement {
  const { state, controller } = useOta();
  const denied = state.phase === 'forbidden' || state.phase === 'expired';
  const empty = state.phase === 'ready' && state.channels.length === 0;
  return (
    <section style={{ padding: 'var(--space-s6, 24px)', ...box, gap: 'var(--space-s4, 16px)' }}>
      <h1 style={{ margin: 0 }}>{text('title')}</h1>
      <p>{text('intro')}</p>
      {denied ? (
        <p role="alert">{text(state.phase === 'expired' ? 'expired' : 'forbidden')}</p>
      ) : null}
      <ReadBanner state={state} />
      {empty ? <p>{text('empty')}</p> : null}
      {!denied && !empty && controller !== null && state.channels.length > 0 ? (
        <Workspace state={state} controller={controller} />
      ) : null}
    </section>
  );
}
