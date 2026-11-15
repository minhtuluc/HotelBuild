'use client';
import { useEffect, useState, type ReactElement } from 'react';
import {
  StateSurface,
  color,
  fontFamily,
  formatDateTimeVn,
  radius,
  space,
  type ScreenState,
} from '@pinehill/ui-web';
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
import { useWorkingPropertyId } from '../../../session/staff-session';
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
  const { controller, state } = useGrid(forced === undefined, useWorkingPropertyId());
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

  const pendingDays = dayCount(pending.from, pending.to);
  const data = state.data;

  return (
    <section
      style={{
        maxWidth: 1440,
        marginInline: 'auto',
        padding: `clamp(${space.s4}px, 3vw, ${space.s6}px)`,
        display: 'grid',
        gap: space.s4,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'grid', gap: space.s1 }}>
        <h1 style={{ margin: 0, fontFamily: fontFamily.sans, fontSize: 24, fontWeight: 500 }}>
          {t('grid.title')}
        </h1>
        <p style={{ margin: 0, color: color.textMuted, maxWidth: '58rem' }}>{t('grid.intro')}</p>
      </div>

      <form
        data-testid="grid-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void controller?.load(propertyId, pending);
        }}
        className="ph-card"
        style={{
          display: 'flex',
          gap: space.s3,
          flexWrap: 'wrap',
          alignItems: 'end',
          padding: space.s4,
          minWidth: 0,
        }}
      >
        <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
          {t('grid.form.property')}
          <select
            value={propertyId}
            onChange={(event) => {
              setPropertyId(event.target.value);
              void controller?.load(event.target.value, pending);
            }}
          >
            {state.properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
          {t('grid.form.from')}
          <input
            type="date"
            value={pending.from}
            onChange={(event) => setPending({ ...pending, from: event.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
          {t('grid.form.to')}
          <input
            type="date"
            value={pending.to}
            onChange={(event) => setPending({ ...pending, to: event.target.value })}
          />
        </label>
        <button type="submit" className="ph-btn-primary">
          {t('grid.form.load')}
        </button>
      </form>

      {pendingDays > MAX_GRID_DAYS ? (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: `${space.s2}px ${space.s3}px`,
            background: '#FDF3F3',
            border: `1px solid ${color.border}`,
            boxShadow: `inset 0 0 0 1px ${color.danger}`,
            borderRadius: radius.sm,
            color: color.danger,
          }}
        >
          {t('grid.rangeTooLong', { max: MAX_GRID_DAYS })}
        </p>
      ) : null}

      <GridLegend />

      {state.phase === 'expired' ? (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: `${space.s3}px ${space.s4}px`,
            background: '#FDF3F3',
            border: `1px solid ${color.border}`,
            boxShadow: `inset 0 0 0 1px ${color.danger}`,
            borderRadius: radius.sm,
            color: color.danger,
          }}
        >
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
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: space.s3,
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13,
          color: color.textMuted,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <p role="status" data-testid="grid-updated" style={{ margin: 0, color: color.text }}>
          {t('grid.updated', {
            from: data.range.from,
            to: data.range.to,
            roomTypes: data.rows.length,
          })}
        </p>
        {data.capturedAt ? (
          <p role="status" data-testid="grid-captured" style={{ margin: 0 }}>
            {gridText('captured', { time: formatDateTimeVn(data.capturedAt) })}
          </p>
        ) : null}
      </div>
      <GridTable dates={dates} rows={data.rows} focus={focus} onFocusChange={onFocusChange} />
    </>
  );
}
