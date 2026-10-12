'use client';
import { useEffect, useState, type ReactElement } from 'react';
import { StateSurface, formatDateTimeVn, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { t } from '../../../lib/i18n';
import {
  MAX_GRID_DAYS,
  dayCount,
  defaultRange,
  gridDates,
  type CellPosition,
  type GridRange,
} from '../../../lib/inventory-grid';
import { GridLegend, GridTable } from './grid-table';
import { useGrid } from './use-grid';
import type { GridState, GridData } from './controller';
import { gridText } from './messages-session';
function surface(state: GridState): ScreenState {
  switch (state.phase) {
    case 'loading':
      return state.data ? { kind: 'ready' } : { kind: 'loading' };
    case 'empty':
      return { kind: 'empty', reason: 'noData', canCreate: false };
    case 'expired':
    case 'forbidden':
      return { kind: 'forbidden' };
    case 'validation':
      return { kind: 'validationError', details: [{ field: 'to', issue: 'RANGE_INVALID' }] };
    default:
      return { kind: 'ready' };
  }
}
export function InventoryGridScreen(): ReactElement {
  const forced = useForcedState();
  const { controller, state } = useGrid(forced === undefined);
  const [propertyId, setPropertyId] = useState('');
  const [pending, setPending] = useState<GridRange>(() => defaultRange(new Date()));
  const [focus, setFocus] = useState<CellPosition>({ row: 0, col: 0 });
  useEffect(() => {
    setPropertyId(state.propertyId);
  }, [state.propertyId]);
  useEffect(() => {
    setFocus({ row: 0, col: 0 });
  }, [state.data]);
  if (forced !== undefined)
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  const pendingDays = dayCount(pending.from, pending.to),
    data = state.data;
  return (
    <section
      style={{
        padding: 'var(--space-s6, 24px)',
        display: 'grid',
        gap: 'var(--space-s4, 16px)',
        minWidth: 0,
      }}
    >
      <h1 style={{ margin: 0 }}>{t('grid.title')}</h1>
      <p style={{ margin: 0 }}>{t('grid.intro')}</p>
      <form
        data-testid="grid-controls"
        onSubmit={(e) => {
          e.preventDefault();
          void controller?.load(propertyId, pending);
        }}
        style={{
          display: 'flex',
          gap: 'var(--space-s2, 8px)',
          flexWrap: 'wrap',
          alignItems: 'end',
          minWidth: 0,
        }}
      >
        <label style={{ display: 'grid', gap: 4 }}>
          {t('grid.form.property')}
          <select
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              void controller?.load(e.target.value, pending);
            }}
          >
            {state.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('grid.form.from')}
          <input
            type="date"
            value={pending.from}
            onChange={(e) => setPending({ ...pending, from: e.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('grid.form.to')}
          <input
            type="date"
            value={pending.to}
            onChange={(e) => setPending({ ...pending, to: e.target.value })}
          />
        </label>
        <button type="submit" style={{ minHeight: 44 }}>
          {t('grid.form.load')}
        </button>
      </form>
      {pendingDays > MAX_GRID_DAYS ? (
        <p role="alert">{t('grid.rangeTooLong', { max: MAX_GRID_DAYS })}</p>
      ) : null}
      <GridLegend />
      {state.phase === 'expired' ? (
        <p role="alert">
          {gridText('expired')} <a href="/login">{gridText('login')}</a>
        </p>
      ) : null}
      <StateSurface state={surface(state)}>
        {state.busy && data ? <p role="status">{gridText('loading')}</p> : null}
        {state.phase === 'error' ? (
          <ScreenAlert
            error={state.error}
            onRetry={() => void controller?.load(state.propertyId, state.range)}
          />
        ) : null}
        <GridResult data={data} focus={focus} onFocusChange={setFocus} />
      </StateSurface>
    </section>
  );
}

function GridResult({
  data,
  focus,
  onFocusChange,
}: {
  data: GridData | null;
  focus: CellPosition;
  onFocusChange: (next: CellPosition) => void;
}): ReactElement | null {
  if (!data || !data.rows.length) return null;
  const dates = gridDates(data.range.from, data.range.to);
  return (
    <>
      <p role="status" data-testid="grid-updated" style={{ margin: 0 }}>
        {t('grid.updated', {
          from: data.range.from,
          to: data.range.to,
          roomTypes: data.rows.length,
        })}
      </p>
      {data.capturedAt ? (
        <p role="status" data-testid="grid-captured">
          {gridText('captured', { time: formatDateTimeVn(data.capturedAt) })}
        </p>
      ) : null}
      <GridTable dates={dates} rows={data.rows} focus={focus} onFocusChange={onFocusChange} />
    </>
  );
}
