'use client';
import type { ReactElement } from 'react';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_TITLE_STYLE,
  opsNoticeStyle,
} from '../../components/editorial-styles';
import { text } from './messages';
import { canSync, type FieldIssue } from './model';
import { OutboxSection } from './outbox';
import { StatusPanel, SyncForm } from './panels';
import { SelectInput } from './parts';
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
        className="ph-btn"
        disabled={busy}
        onClick={() => void controller.load()}
        style={{ ...OPS_COMPACT_BTN_STYLE, justifySelf: 'start' }}
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
    <section style={OPS_PAGE_STYLE}>
      <header style={OPS_HEADER_STYLE}>
        <h1 style={OPS_TITLE_STYLE}>{text('title')}</h1>
        <p style={OPS_INTRO_STYLE}>{text('intro')}</p>
      </header>
      {denied ? (
        <p role="alert" style={opsNoticeStyle('danger')}>
          {text(state.phase === 'expired' ? 'expired' : 'forbidden')}
        </p>
      ) : null}
      <ReadBanner state={state} />
      {empty ? <p>{text('empty')}</p> : null}
      {!denied && !empty && controller !== null && state.channels.length > 0 ? (
        <Workspace state={state} controller={controller} />
      ) : null}
    </section>
  );
}
