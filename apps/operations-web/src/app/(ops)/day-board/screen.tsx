'use client';
import type { ReactElement, FormEvent } from 'react';
import Link from 'next/link';
import { StateSurface, formatDateTimeVn, color, space, type ScreenState } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_FILTER_ROW_STYLE,
  OPS_PAGE_STYLE,
  OPS_SUBTITLE_STYLE,
  OPS_TABLE_WRAP_STYLE,
  OPS_TABULAR_STYLE,
  OPS_TITLE_STYLE,
} from '../../../components/editorial-styles';
import { useForcedState } from '../../../components/forced-state';
import { ScreenAlert } from '../../../components/screen-alert';
import { t } from '../../../lib/i18n';
import { useDayBoard } from './use-board';
import { dayText } from './messages';
import { validDay, type DayData } from './model';
import type { DayState, DayBoardController } from './controller';

function surface(state: DayState): ScreenState {
  if (state.phase === 'forbidden') return { kind: 'forbidden' };
  if (state.phase === 'loading' && !state.data) return { kind: 'loading' };
  if (!validDay(state.date))
    return { kind: 'validationError', details: [{ field: 'date', issue: dayText('invalidDate') }] };
  if (state.phase === 'ready' && state.data?.rows.length === 0)
    return { kind: 'empty', reason: 'noData', canCreate: false };
  return refreshSurface(state);
}
function refreshSurface(state: DayState): ScreenState {
  if (state.phase === 'loading' && state.data?.capturedAt)
    return { kind: 'refreshing', updatedAt: state.data.capturedAt, stale: true };
  return { kind: 'ready' };
}
export function DayBoardScreen({
  baseUrl,
  initialDay,
}: {
  baseUrl: string;
  initialDay: string;
}): ReactElement {
  const forced = useForcedState();
  const { controller, state } = useDayBoard(baseUrl, initialDay, forced === undefined);
  if (forced)
    return (
      <section style={OPS_PAGE_STYLE}>
        <h1 style={OPS_TITLE_STYLE}>{dayText('title')}</h1>
        <StateSurface state={forced}>
          <p>{t('screen.demo')}</p>
        </StateSurface>
      </section>
    );
  return (
    <section style={OPS_PAGE_STYLE}>
      <h1 style={OPS_TITLE_STYLE}>{dayText('title')}</h1>
      <DayForm controller={controller} state={state} />
      {state.error ? (
        <ScreenAlert error={state.error} onRetry={() => void controller.load()} />
      ) : null}
      <StateSurface state={surface(state)}>
        {state.data ? <DayTable data={state.data} /> : null}
      </StateSurface>
      <QuickLinks />
      <section
        data-testid="day-unsupported"
        className="ph-card"
        style={{ display: 'grid', gap: space.s2 }}
      >
        <h2 style={OPS_SUBTITLE_STYLE}>{dayText('unsupported')}</h2>
        <p style={{ margin: 0, color: color.textMuted }}>{dayText('arrivals')}</p>
        <p style={{ margin: 0, color: color.textMuted }}>{dayText('cases')}</p>
        <p style={{ margin: 0, color: color.textMuted }}>{dayText('channels')}</p>
      </section>
    </section>
  );
}
function DayForm({
  controller,
  state,
}: {
  controller: DayBoardController;
  state: DayState;
}): ReactElement {
  const denied = state.phase === 'forbidden';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void controller.load();
  };
  return (
    <form onSubmit={submit} className="ph-card ph-filter-row" style={OPS_FILTER_ROW_STYLE}>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {dayText('date')}
        <input
          name="date"
          type="date"
          value={state.date}
          disabled={denied}
          onChange={(event) => controller.selectDate(event.target.value)}
          aria-invalid={!validDay(state.date)}
        />
      </label>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {dayText('property')}
        <select
          name="propertyId"
          aria-label={dayText('property')}
          value={state.propertyId}
          disabled={denied}
          style={{ maxWidth: '100%' }}
          onChange={(event) => controller.selectProperty(event.target.value)}
        >
          {state.properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="ph-btn-primary"
        style={OPS_COMPACT_BTN_STYLE}
        type="submit"
        disabled={denied || state.phase === 'loading'}
      >
        {dayText('apply')}
      </button>
    </form>
  );
}
function DayTable({ data }: { data: DayData }): ReactElement {
  const property = data.properties.find((item) => item.id === data.propertyId);
  return (
    <section style={{ display: 'grid', gap: space.s3 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: space.s2,
          fontSize: 13,
          color: color.textMuted,
          ...OPS_TABULAR_STYLE,
        }}
      >
        <p data-testid="day-displayed" style={{ margin: 0, color: color.text, fontWeight: 500 }}>
          {dayText('displayed', { date: data.date, property: property?.name ?? data.propertyId })}
        </p>
        <p data-testid="day-captured" style={{ margin: 0 }}>
          {data.capturedAt
            ? dayText('captured', { time: formatDateTimeVn(data.capturedAt) })
            : dayText('missingTime')}
        </p>
      </div>
      <div style={OPS_TABLE_WRAP_STYLE}>
        <table style={{ tableLayout: 'fixed', ...OPS_TABULAR_STYLE }}>
          <caption
            style={{ textAlign: 'left', fontWeight: 500, padding: space.s3, color: color.text }}
          >
            {dayText('table')}
          </caption>
          <thead>
            <tr>
              <th scope="col">{dayText('type')}</th>
              <th scope="col">{dayText('available')}</th>
              <th scope="col">{dayText('unit')}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.roomTypeId} data-testid={`day-row-${row.roomTypeId}`}>
                <th scope="row" style={{ textAlign: 'left' }}>
                  {row.code}
                </th>
                <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.available}</td>
                <td style={{ textAlign: 'center' }}>{dayText(row.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function QuickLinks(): ReactElement {
  return (
    <nav aria-label={dayText('quick')} style={{ display: 'flex', flexWrap: 'wrap', gap: space.s2 }}>
      <Link className="ph-btn" style={OPS_COMPACT_BTN_STYLE} href="/inventory-grid">
        {dayText('grid')}
      </Link>
      <Link className="ph-btn" style={OPS_COMPACT_BTN_STYLE} href="/channel-allotments">
        {dayText('allotment')}
      </Link>
      <Link className="ph-btn" style={OPS_COMPACT_BTN_STYLE} href="/room-blocks">
        {dayText('blocks')}
      </Link>
    </nav>
  );
}
