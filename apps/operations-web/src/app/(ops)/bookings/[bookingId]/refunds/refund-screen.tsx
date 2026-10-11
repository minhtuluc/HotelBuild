'use client';
import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import type { RefundRequest } from '@pinehill/contracts';
import { ScreenAlert } from '../../../../../components/screen-alert';
import { useForcedState } from '../../../../../components/forced-state';
import { t } from '../../../../../lib/i18n';
import { useRefundWorkspace, type RefundWorkspace } from './refund-workspace';
import { useRefundActions, type RefundControls } from './refund-actions';
import { RefundDetail } from './refund-parts';
import { RefundForm } from './refund-form';
function RefundList({
  refunds,
  controls,
  onSelect,
}: {
  refunds: RefundRequest[];
  controls: RefundControls;
  onSelect: (id: string) => void;
}): ReactElement {
  if (!refunds.length) return <p data-testid="refund-empty">{t('ops.refunds.empty')}</p>;
  return (
    <ul style={{ margin: 0, paddingInlineStart: 20 }}>
      {refunds.map((value) => (
        <li key={value.id}>
          <button
            type="button"
            disabled={controls.busy || controls.intent !== null}
            onClick={() => {
              controls.reset();
              onSelect(value.id);
            }}
            style={{ overflowWrap: 'anywhere' }}
          >
            {t('ops.refunds.select', { id: value.id })}
          </button>
        </li>
      ))}
    </ul>
  );
}
function RefundContent({
  workspace,
  controls,
}: {
  workspace: RefundWorkspace;
  controls: RefundControls;
}): ReactElement | null {
  const [selected, setSelected] = useState<string | null>(null);
  const data = workspace.data;
  if (!data) return null;
  const refund = data.refunds.find((value) => value.id === selected) ?? data.refunds[0];
  const canCreate = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'].includes(
    data.user.role,
  );
  return (
    <>
      <p style={{ margin: 0 }}>{data.booking.code}</p>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="refund-reload"
          disabled={controls.busy || workspace.readingNow}
          onClick={() => void workspace.reload()}
        >
          {t('ops.refunds.reload')}
        </button>
        {canCreate ? (
          <button
            type="button"
            data-testid="refund-create"
            disabled={controls.blocked}
            onClick={() => controls.begin({ action: 'create', target: null })}
          >
            {t('ops.refunds.create')}
          </button>
        ) : null}
      </div>
      <h2 style={{ margin: 0 }}>{t('ops.refunds.list')}</h2>
      <RefundList refunds={data.refunds} controls={controls} onSelect={setSelected} />
      {refund ? (
        <RefundDetail refund={refund} balance={data.balance} user={data.user} controls={controls} />
      ) : null}
      <RefundForm controls={controls} booking={data.booking} />
    </>
  );
}
function RefundState({
  state,
  workspace,
  controls,
}: {
  state: ScreenState;
  workspace: RefundWorkspace;
  controls: RefundControls;
}): ReactElement {
  const successful = state.kind === 'success';
  return (
    <>
      {successful ? <p role="status">{t('ops.refunds.confirmed')}</p> : null}
      <StateSurface state={successful ? { kind: 'ready' } : state}>
        <RefundContent workspace={workspace} controls={controls} />
      </StateSurface>
    </>
  );
}
export function RefundScreen({
  baseUrl,
  bookingId,
}: {
  baseUrl: string;
  bookingId: string;
}): ReactElement {
  const forced = useForcedState();
  const workspace = useRefundWorkspace(baseUrl, bookingId, forced === undefined);
  const controls = useRefundActions(workspace);
  const state =
    workspace.state.kind === 'forbidden' ? workspace.state : (controls.state ?? workspace.state);
  return (
    <section
      data-testid="refund-screen"
      style={{ display: 'grid', gap: 16, padding: '16px 0', maxWidth: 800, minWidth: 0 }}
    >
      <h1 style={{ margin: 0 }}>{t('ops.refunds.title')}</h1>
      <Link href={`/bookings/${encodeURIComponent(bookingId)}`}>{t('ops.refunds.back')}</Link>
      {forced === undefined ? (
        <RefundState state={state} workspace={workspace} controls={controls} />
      ) : (
        <StateSurface state={forced} />
      )}
      {forced !== undefined ||
      workspace.error === null ||
      workspace.state.kind === 'forbidden' ? null : (
        <ScreenAlert error={workspace.error} onRetry={() => void workspace.reload()} />
      )}
    </section>
  );
}
