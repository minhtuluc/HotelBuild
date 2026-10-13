'use client';
import type { ReactElement } from 'react';
import { StateSurface } from '@pinehill/ui-web';
import { useForcedState } from '../../../components/forced-state';
import { t } from '../../../lib/i18n';
import { AdminPanels } from '../admin-commands/panels';
import { AllotmentTable } from './allotment-table';
import { AllotmentControls } from './controls';
import { allotmentText as text } from './messages';
import { useAllotments } from './use-allotments';
type Model = ReturnType<typeof useAllotments>;
export function ChannelAllotmentsScreen(): ReactElement {
  const forced = useForcedState();
  const model = useAllotments(forced === undefined);
  if (forced !== undefined)
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  return (
    <section
      style={{
        padding: 'var(--space-s6, 24px)',
        display: 'grid',
        gap: 'var(--space-s4, 16px)',
        minWidth: 0,
      }}
    >
      <h1 style={{ margin: 0 }}>{t('allotments.title')}</h1>
      <p>{t('allotments.intro')}</p>
      <Status model={model} />
      <AllotmentControls model={model} onSelect={model.clearEditor} />
      <CurrentData model={model} />
    </section>
  );
}
function Status({ model }: { model: Model }): ReactElement {
  const { state, controller, current, visible } = model;
  return (
    <>
      <button
        type="button"
        disabled={state.busy}
        onClick={() => void controller?.load()}
        style={{ minHeight: 44, justifySelf: 'start' }}
      >
        {text('reload')}
      </button>
      <AdminPanels
        state={state}
        controller={controller}
        version={visible?.tag ?? current?.tag ?? '—'}
      />
      {state.receipt?.kind === 'allotment-put' ? (
        <p role="status" data-testid="allotments-saved">
          {current ? text('saved') : text('received')}
        </p>
      ) : null}
    </>
  );
}
function CurrentData({ model }: { model: Model }): ReactElement | null {
  const { state, current, visible, adopt } = model;
  if (!current) return null;
  return (
    <>
      <p>{text('current', { tag: current.tag })}</p>
      {visible ? <p>{text('prior', { tag: visible.tag })}</p> : null}
      <p role="note">{text('direct')}</p>
      {!current.rows.length ? <p>{text('empty')}</p> : null}
      <p>{text('unknownUsed')}</p>
      <DraftTable model={model} />
      {state.phase === 'conflict' ? (
        <div>
          {current.rows.map((row) => (
            <p key={row.date}>{text('compare', { date: row.date, value: row.allotment })}</p>
          ))}
          <button
            type="button"
            disabled={!state.canCompare || state.busy}
            onClick={adopt}
            style={{ minHeight: 44 }}
          >
            {text('adopt')}
          </button>
        </div>
      ) : null}
    </>
  );
}
function DraftTable({ model }: { model: Model }): ReactElement {
  const { state, controller, rows, sellingUnits, change, submit } = model;
  return (
    <>
      <AllotmentTable
        rows={rows}
        sellingUnits={sellingUnits}
        editable={state.canWrite}
        disabled={!controller?.canStart()}
        onChange={change}
      />
      {state.canWrite ? (
        <form onSubmit={(event) => void submit(event)} data-testid="allotment-editor">
          <button type="submit" disabled={!controller?.canStart()} style={{ minHeight: 44 }}>
            {t('allotments.save')}
          </button>
        </form>
      ) : null}
    </>
  );
}
