'use client';
import type { ReactElement } from 'react';
import { StateSurface, color, space } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_HEADER_ROW_STYLE,
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_TABULAR_STYLE,
  OPS_TITLE_STYLE,
  opsNoticeStyle,
} from '../../../components/editorial-styles';
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
    <section style={OPS_PAGE_STYLE}>
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
      <div style={OPS_HEADER_ROW_STYLE}>
        <div style={OPS_HEADER_STYLE}>
          <h1 style={OPS_TITLE_STYLE}>{t('allotments.title')}</h1>
          <p style={OPS_INTRO_STYLE}>{t('allotments.intro')}</p>
        </div>
        <button
          type="button"
          disabled={state.busy}
          onClick={() => void controller?.load()}
          className="ph-btn"
          style={OPS_COMPACT_BTN_STYLE}
        >
          {text('reload')}
        </button>
      </div>
      <AdminPanels
        state={state}
        controller={controller}
        version={visible?.tag ?? current?.tag ?? '—'}
      />
      {state.receipt?.kind === 'allotment-put' ? (
        <p
          role="status"
          data-testid="allotments-saved"
          style={{ ...opsNoticeStyle('success'), color: color.success, fontWeight: 500 }}
        >
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
      <div
        className="ph-card"
        style={{
          display: 'grid',
          gap: space.s2,
          padding: space.s4,
          fontSize: 13,
          color: color.textMuted,
          ...OPS_TABULAR_STYLE,
        }}
      >
        <p style={{ margin: 0, color: color.text, fontWeight: 500 }}>
          {text('current', { tag: current.tag })}
        </p>
        {visible ? <p style={{ margin: 0 }}>{text('prior', { tag: visible.tag })}</p> : null}
        <p role="note" style={{ margin: 0 }}>
          {text('direct')}
        </p>
        {!current.rows.length ? <p style={{ margin: 0 }}>{text('empty')}</p> : null}
        <p style={{ margin: 0 }}>{text('unknownUsed')}</p>
      </div>
      <DraftTable model={model} />
      {state.phase === 'conflict' ? (
        <div style={opsNoticeStyle('warning')}>
          {current.rows.map((row) => (
            <p key={row.date} style={{ margin: 0, ...OPS_TABULAR_STYLE }}>
              {text('compare', { date: row.date, value: row.allotment })}
            </p>
          ))}
          <button
            type="button"
            disabled={!state.canCompare || state.busy}
            onClick={adopt}
            className="ph-btn"
            style={{ ...OPS_COMPACT_BTN_STYLE, justifySelf: 'start' }}
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
          <button
            type="submit"
            disabled={!controller?.canStart()}
            className="ph-btn-primary"
            style={OPS_COMPACT_BTN_STYLE}
          >
            {t('allotments.save')}
          </button>
        </form>
      ) : null}
    </>
  );
}
