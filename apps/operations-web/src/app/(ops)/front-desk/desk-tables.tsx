'use client';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { formatBusinessDate } from '../../../lib/business-date';
import { t } from '../../../lib/i18n';
import { STATUS_KEYS } from '../bookings/bookings-model';
import {
  StateSurface,
  color,
  formatMoney,
  radius,
  space,
  touchTargetPx,
  typography,
  type ScreenState,
} from '@pinehill/ui-web';
import type { BookingSummary } from '@pinehill/contracts';
import type { ActionFailure } from './front-desk-model';
import { deskText } from './messages';

export const CONTROL = {
  minHeight: touchTargetPx,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  padding: space.s2,
  background: color.surface,
  color: color.text,
} as const;

const CELL = { padding: space.s2, textAlign: 'left', verticalAlign: 'top' } as const;

export type DeskPanel = {
  readonly kind: 'checkIn' | 'checkOut' | 'noShow';
  readonly booking: BookingSummary;
};

/**
 * Lỗi của lệnh ghi: từ chối nghiệp vụ hiện đúng mã + lý do máy chủ trả (AC1); kết quả chưa xác định chỉ
 * cho **đọc lại**, tuyệt đối không gửi lại mù.
 */
export function FailureNotice({
  failure,
  onInspect,
}: {
  failure: ActionFailure;
  onInspect: () => void;
}): ReactElement {
  if (failure.kind === 'rejected')
    return (
      <div role="alert" data-testid="action-rejected" style={{ display: 'grid', gap: 4 }}>
        <strong>{deskText('rejected')}</strong>
        <span>{deskText('rejectedCode', { code: failure.code })}</span>
        <span>{deskText('rejectedReason', { reason: failure.reason })}</span>
      </div>
    );
  const state: ScreenState =
    failure.kind === 'forbidden'
      ? { kind: 'forbidden' }
      : failure.kind === 'conflict'
        ? { kind: 'conflict', currentVersion: '—', attemptedVersion: '—', onReload: onInspect }
        : { kind: 'unknownOutcome', referenceId: failure.reference, onLookup: onInspect };
  return <StateSurface state={state} />;
}

function DeskTable({
  id,
  title,
  rows,
  kind,
  onAction,
}: {
  id: string;
  title: string;
  rows: readonly BookingSummary[];
  kind: 'arrival' | 'stay';
  onAction: (panel: DeskPanel) => void;
}): ReactElement {
  return (
    <section aria-labelledby={`${id}-title`} data-testid={id} style={{ display: 'grid', gap: 8 }}>
      <h2 id={`${id}-title`} style={{ margin: 0, fontSize: typography.h2.web }}>
        {title} ({rows.length})
      </h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <caption style={{ textAlign: 'left', paddingBottom: 4 }}>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{deskText('code')}</th>
              <th scope="col">{deskText('guest')}</th>
              <th scope="col">{deskText('status')}</th>
              <th scope="col">{deskText('stay')}</th>
              <th scope="col">{deskText('balance')}</th>
              <th scope="col">{deskText('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((booking) => (
              <tr key={booking.id} data-testid={`${id}-booking-${booking.id}`}>
                <th scope="row" style={CELL}>
                  {booking.code}
                </th>
                <td style={CELL}>{booking.guestId}</td>
                <td style={CELL}>{t(STATUS_KEYS[booking.status])}</td>
                <td style={CELL}>
                  {formatBusinessDate(booking.checkIn)} → {formatBusinessDate(booking.checkOut)} ·{' '}
                  {booking.nights} · {booking.roomCount}
                </td>
                <td style={{ ...CELL, fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(booking.balanceDue)}
                </td>
                <td style={CELL}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button
                      type="button"
                      style={CONTROL}
                      onClick={() => {
                        onAction({ kind: kind === 'arrival' ? 'checkIn' : 'checkOut', booking });
                      }}
                    >
                      {kind === 'arrival' ? deskText('checkIn') : deskText('checkOut')}
                    </button>
                    {kind === 'arrival' ? (
                      <button
                        type="button"
                        style={CONTROL}
                        onClick={() => {
                          onAction({ kind: 'noShow', booking });
                        }}
                      >
                        {deskText('noShow')}
                      </button>
                    ) : null}
                    <Link
                      style={{ ...CONTROL, display: 'inline-flex', alignItems: 'center' }}
                      href={`/bookings/${encodeURIComponent(booking.id)}/collect`}
                    >
                      {deskText('collect')}
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DeskTables({
  arrivals,
  inHouse,
  departures,
  onAction,
}: {
  arrivals: readonly BookingSummary[];
  inHouse: readonly BookingSummary[];
  departures: readonly BookingSummary[];
  onAction: (panel: DeskPanel) => void;
}): ReactElement {
  return (
    <div style={{ display: 'grid', gap: space.s6 }}>
      <DeskTable
        id="desk-arrivals"
        title={deskText('tableArrivals')}
        rows={arrivals}
        kind="arrival"
        onAction={onAction}
      />
      <DeskTable
        id="desk-in-house"
        title={deskText('tableInHouse')}
        rows={inHouse}
        kind="stay"
        onAction={onAction}
      />
      <DeskTable
        id="desk-departures"
        title={deskText('tableDepartures')}
        rows={departures}
        kind="stay"
        onAction={onAction}
      />
    </div>
  );
}
