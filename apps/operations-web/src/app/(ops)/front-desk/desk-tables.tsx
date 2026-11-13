'use client';
import type { CSSProperties, ReactElement } from 'react';
import Link from 'next/link';
import { formatBusinessDate } from '../../../lib/business-date';
import { t } from '../../../lib/i18n';
import { STATUS_KEYS } from '../bookings/bookings-model';
import {
  StateSurface,
  color,
  fontFamily,
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

export const CONTROL: CSSProperties = {
  minHeight: touchTargetPx,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  padding: `0 ${space.s3}px`,
  background: color.surface,
  color: color.text,
  fontSize: 13,
  fontWeight: 500,
};

const COMPACT_ACTION: CSSProperties = {
  whiteSpace: 'nowrap',
};

const CELL: CSSProperties = {
  padding: `${space.s3}px ${space.s3}px`,
  textAlign: 'left',
  verticalAlign: 'middle',
};

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
      <div
        role="alert"
        data-testid="action-rejected"
        style={{
          display: 'grid',
          gap: 4,
          padding: `${space.s3}px ${space.s4}px`,
          background: '#FDF3F3',
          border: `1px solid ${color.border}`,
          boxShadow: `inset 0 0 0 1px ${color.danger}`,
          borderRadius: radius.sm,
          color: color.danger,
        }}
      >
        <strong>{deskText('rejected')}</strong>
        <span style={{ fontSize: 14 }}>{deskText('rejectedCode', { code: failure.code })}</span>
        <span style={{ fontSize: 14 }}>
          {deskText('rejectedReason', { reason: failure.reason })}
        </span>
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
  accent,
  rows,
  kind,
  onAction,
}: {
  id: string;
  title: string;
  accent: string;
  rows: readonly BookingSummary[];
  kind: 'arrival' | 'stay';
  onAction: (panel: DeskPanel) => void;
}): ReactElement {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-testid={id}
      className="ph-card"
      style={{
        display: 'grid',
        gap: space.s3,
        boxShadow: `inset 0 0 0 1px ${accent}`,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: space.s2,
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h2
          id={`${id}-title`}
          style={{ margin: 0, fontFamily: fontFamily.sans, fontSize: typography.h2.web }}
        >
          {title} ({rows.length})
        </h2>
      </div>
      <div
        style={{
          overflowX: 'auto',
          maxWidth: '100%',
          border: `1px solid ${color.border}`,
          borderRadius: radius.sm,
        }}
      >
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}
        >
          <caption className="sr-only">{title}</caption>
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
                <th scope="row" style={{ ...CELL, whiteSpace: 'nowrap', fontWeight: 600 }}>
                  {booking.code}
                </th>
                <td style={CELL}>{booking.guestId}</td>
                <td style={CELL}>{t(STATUS_KEYS[booking.status])}</td>
                <td style={{ ...CELL, whiteSpace: 'nowrap' }}>
                  {formatBusinessDate(booking.checkIn)} → {formatBusinessDate(booking.checkOut)} ·{' '}
                  {booking.nights} · {booking.roomCount}
                </td>
                <td
                  style={{
                    ...CELL,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                    fontWeight: 500,
                  }}
                >
                  {formatMoney(booking.balanceDue)}
                </td>
                <td style={CELL}>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: space.s2,
                      alignItems: 'center',
                    }}
                  >
                    <button
                      type="button"
                      className="ph-btn-primary"
                      style={COMPACT_ACTION}
                      onClick={() => {
                        onAction({ kind: kind === 'arrival' ? 'checkIn' : 'checkOut', booking });
                      }}
                    >
                      {kind === 'arrival' ? deskText('checkIn') : deskText('checkOut')}
                    </button>
                    {kind === 'arrival' ? (
                      <button
                        type="button"
                        className="ph-btn"
                        style={COMPACT_ACTION}
                        onClick={() => {
                          onAction({ kind: 'noShow', booking });
                        }}
                      >
                        {deskText('noShow')}
                      </button>
                    ) : null}
                    <Link
                      className="ph-btn"
                      style={COMPACT_ACTION}
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
    <div style={{ display: 'grid', gap: space.s4, minWidth: 0 }}>
      <div
        className="ph-facts"
        style={{
          background: color.surface,
          border: `1px solid ${color.border}`,
          borderRadius: radius.sm,
          padding: `${space.s3}px ${space.s4}px`,
        }}
      >
        <div>
          <span style={{ display: 'block', fontSize: 12, color: color.textMuted }}>
            {deskText('arrivals')}
          </span>
          <strong style={{ fontFamily: fontFamily.sans, fontSize: 22, color: color.primary }}>
            {arrivals.length}
          </strong>
        </div>
        <div>
          <span style={{ display: 'block', fontSize: 12, color: color.textMuted }}>
            {deskText('inHouse')}
          </span>
          <strong style={{ fontFamily: fontFamily.sans, fontSize: 22, color: color.info }}>
            {inHouse.length}
          </strong>
        </div>
        <div>
          <span style={{ display: 'block', fontSize: 12, color: color.textMuted }}>
            {deskText('departures')}
          </span>
          <strong style={{ fontFamily: fontFamily.sans, fontSize: 22, color: color.primary }}>
            {departures.length}
          </strong>
        </div>
      </div>
      <DeskTable
        id="desk-arrivals"
        title={deskText('tableArrivals')}
        accent={color.primary}
        rows={arrivals}
        kind="arrival"
        onAction={onAction}
      />
      <DeskTable
        id="desk-in-house"
        title={deskText('tableInHouse')}
        accent={color.info}
        rows={inHouse}
        kind="stay"
        onAction={onAction}
      />
      <DeskTable
        id="desk-departures"
        title={deskText('tableDepartures')}
        accent={color.primary}
        rows={departures}
        kind="stay"
        onAction={onAction}
      />
    </div>
  );
}
