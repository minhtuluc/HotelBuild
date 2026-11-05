'use client';
import type { ReactElement } from 'react';
import { text } from './messages';
import { canSync, type FieldIssue } from './model';
import { OutboxSection } from './outbox';
import { StatusPanel, SyncForm } from './panels';
import { SelectInput, box } from './parts';
import { CommandStatus, OperationPanel, ReadBanner } from './status';
import type { ControllerState, SyncController } from './controller';
import { useSync } from './use-sync';
import { defaultRange } from '../../lib/inventory-grid';

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
  controller: SyncController;
}): ReactElement {
  const role = state.actor?.role;
  const mayAct = role !== undefined && canSync(role);
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
      {state.status === null ? null : <StatusPanel status={state.status} />}
      <div aria-live="polite" data-testid="hb133-command">
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
      <OperationPanel
        operation={state.operation}
        onCheck={() => void controller.checkOperation()}
        onRetry={() => void controller.retryFailedSync()}
        canRetry={mayAct}
      />
      {mayAct ? (
        <SyncForm
          date={defaultRange(new Date()).from}
          serverIssues={serverIssues(state)}
          busy={busy}
          onSubmit={(draft) => void controller.submitSync(draft)}
        />
      ) : null}
      <OutboxSection
        deliveries={state.deliveries}
        filter={state.filter}
        canReplay={mayAct}
        busy={busy}
        onFilter={(filter) => void controller.setFilter(filter)}
        onMore={() => void controller.loadMore()}
        onReplay={(id) => void controller.submitRetry(id)}
      />
    </>
  );
}

export function ChannelSyncScreen(): ReactElement {
  const { state, controller } = useSync();
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
