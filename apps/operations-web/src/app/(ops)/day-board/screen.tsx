'use client';
import type { ReactElement, FormEvent } from 'react';
import Link from 'next/link';
import {
  StateSurface,
  formatDateTimeVn,
  color,
  space,
  typography,
  touchTargetPx,
  radius,
  type ScreenState,
} from '@pinehill/ui-web';
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
      <section style={{ padding: space.s4 }}>
        <h1 style={{ fontSize: typography.h1.web, fontWeight: typography.h1.weight }}>
          {dayText('title')}
        </h1>
        <StateSurface state={forced}>
          <p>{t('screen.demo')}</p>
        </StateSurface>
      </section>
    );
  return (
    <section
      style={{
        padding: space.s4,
        display: 'grid',
        gap: space.s4,
        maxWidth: 960,
      }}
    >
      <h1 style={{ margin: 0, fontSize: typography.h1.web, fontWeight: typography.h1.weight }}>
        {dayText('title')}
      </h1>
      <DayForm controller={controller} state={state} />
      {state.error ? (
        <ScreenAlert error={state.error} onRetry={() => void controller.load()} />
      ) : null}
      <StateSurface state={surface(state)}>
        {state.data ? <DayTable data={state.data} /> : null}
      </StateSurface>
      <QuickLinks />
      <section data-testid="day-unsupported">
        <h2 style={{ fontSize: typography.h2.web, fontWeight: typography.h2.weight }}>
          {dayText('unsupported')}
        </h2>
        <p>{dayText('arrivals')}</p>
        <p>{dayText('cases')}</p>
        <p>{dayText('channels')}</p>
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
    <form
      onSubmit={submit}
      style={{ display: 'flex', flexWrap: 'wrap', gap: space.s3, alignItems: 'end' }}
    >
      <label style={{ display: 'grid', gap: 4 }}>
        {dayText('date')}
        <input
          style={CONTROL_STYLE}
          name="date"
          type="date"
          value={state.date}
          disabled={denied}
          onChange={(event) => controller.selectDate(event.target.value)}
          aria-invalid={!validDay(state.date)}
        />
      </label>
      <label style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        {dayText('property')}
        <select
          name="propertyId"
          aria-label={dayText('property')}
          value={state.propertyId}
          disabled={denied}
          style={{ ...CONTROL_STYLE, maxWidth: '100%' }}
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
        style={{
          ...CONTROL_STYLE,
          padding: '8px 16px',
          background: color.primary,
          color: color.surface,
        }}
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
    <section style={{ display: 'grid', gap: 8 }}>
      <p data-testid="day-displayed" style={{ margin: 0 }}>
        {dayText('displayed', { date: data.date, property: property?.name ?? data.propertyId })}
      </p>
      <p data-testid="day-captured" style={{ margin: 0 }}>
        {data.capturedAt
          ? dayText('captured', { time: formatDateTimeVn(data.capturedAt) })
          : dayText('missingTime')}
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <caption style={{ textAlign: 'left', fontWeight: 600, padding: '8px 0' }}>
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
              <th scope="row" style={{ padding: 8, textAlign: 'left' }}>
                {row.code}
              </th>
              <td style={{ padding: 8, textAlign: 'center' }}>{row.available}</td>
              <td style={{ padding: 8, textAlign: 'center' }}>{dayText(row.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
function QuickLinks(): ReactElement {
  return (
    <nav aria-label={dayText('quick')} style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      <Link style={LINK_STYLE} href="/inventory-grid">
        {dayText('grid')}
      </Link>
      <Link style={LINK_STYLE} href="/channel-allotments">
        {dayText('allotment')}
      </Link>
      <Link style={LINK_STYLE} href="/room-blocks">
        {dayText('blocks')}
      </Link>
    </nav>
  );
}

const CONTROL_STYLE = {
  minHeight: touchTargetPx,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  padding: space.s2,
  background: color.surface,
  color: color.text,
} as const;
const LINK_STYLE = {
  minHeight: touchTargetPx,
  display: 'inline-flex',
  alignItems: 'center',
  color: color.primary,
  textDecoration: 'underline',
} as const;
