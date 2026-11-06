'use client';
import { useState, type ReactElement } from 'react';
import { formatDateTimeVn } from '@pinehill/ui-web';
import type { ChannelSyncStatusView } from '@pinehill/contracts';
import { text } from './messages';
import { emptySync, syncIssues, type FieldIssue, type SyncDraft } from './model';
import { ConfirmDialog, SelectInput, TextInput, box } from './parts';

const when = (value: string | null): string =>
  value === null ? text('never') : formatDateTimeVn(value);

/** Số liệu đúng như máy chủ trả: không đếm lỗi, không tự đặt DEGRADED. */
export function StatusPanel({ status }: { status: ChannelSyncStatusView }): ReactElement {
  return (
    <section style={box} aria-labelledby="hb133-status-title" data-testid="hb133-status">
      <h2 id="hb133-status-title">{text('statusTitle')}</h2>
      <p data-testid="hb133-sync-state">
        {status.syncStatus === 'OK' ? text('statusOk') : text('statusDegraded')}
      </p>
      <p>{text('failures', { count: status.consecutiveFailures })}</p>
      <p>{text('lastSync', { time: when(status.lastSyncAt) })}</p>
      <p>{text('lastSuccess', { time: when(status.lastSuccessAt) })}</p>
      <p>{text('lastVerified', { time: when(status.lastVerifiedAt) })}</p>
      {status.lastError === null ? null : <p>{text('lastError', { error: status.lastError })}</p>}
      {status.history.length === 0 ? null : (
        <div
          role="region"
          aria-label={text('historyTitle')}
          tabIndex={0}
          style={{ overflowX: 'auto', maxWidth: '100%' }}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{text('colAt')}</th>
                <th scope="col">{text('colOutcome')}</th>
                <th scope="col">{text('colError')}</th>
              </tr>
            </thead>
            <tbody>
              {status.history.map((entry) => (
                <tr key={entry.at}>
                  <th scope="row">{formatDateTimeVn(entry.at)}</th>
                  <td>{entry.outcome === 'SUCCESS' ? text('success') : text('failure')}</td>
                  <td>{entry.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function SyncForm(props: {
  date: string;
  serverIssues: readonly FieldIssue[];
  busy: boolean;
  onSubmit: (draft: SyncDraft) => void;
}): ReactElement {
  const [draft, setDraft] = useState<SyncDraft>(() => emptySync(props.date));
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  const [asking, setAsking] = useState(false);
  const issues = [...local, ...props.serverIssues];
  const patch = (next: Partial<SyncDraft>) => {
    setLocal([]);
    setDraft({ ...draft, ...next });
  };
  return (
    <form
      style={box}
      aria-labelledby="hb133-sync-title"
      onSubmit={(event) => {
        event.preventDefault();
        const found = syncIssues(draft);
        setLocal(found);
        if (found.length === 0) setAsking(true);
      }}
    >
      <h2 id="hb133-sync-title">{text('syncTitle')}</h2>
      <p>{text('syncRole')}</p>
      <SelectInput
        name="scope"
        label={text('scope')}
        value={draft.scope}
        options={[
          { id: 'FULL', label: text('full') },
          { id: 'RANGE', label: text('range') },
        ]}
        onChange={(value) => patch({ scope: value === 'RANGE' ? 'RANGE' : 'FULL' })}
      />
      {draft.scope === 'RANGE' ? (
        <>
          <TextInput
            name="from"
            type="date"
            label={text('from')}
            value={draft.from}
            issues={issues}
            onChange={(value) => patch({ from: value })}
          />
          <TextInput
            name="to"
            type="date"
            label={text('to')}
            value={draft.to}
            issues={issues}
            onChange={(value) => patch({ to: value })}
          />
        </>
      ) : null}
      <button
        type="submit"
        disabled={props.busy}
        style={{ minHeight: 44, justifySelf: 'start' }}
        data-testid="hb133-sync-submit"
      >
        {text('syncNow')}
      </button>
      <ConfirmDialog
        id="hb133-dialog-sync"
        open={asking}
        title={text('syncTitle')}
        confirmLabel={text('confirmSync')}
        cancelLabel={text('cancel')}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          props.onSubmit(draft);
        }}
      >
        <p>{draft.scope === 'FULL' ? text('full') : `${draft.from} → ${draft.to}`}</p>
      </ConfirmDialog>
    </form>
  );
}
