'use client';
/**
 * HB-309 (TD-09) — phần "trong ngày" của SCR-23 từ `GET /operations/day-board`: dải tóm tắt, khách
 * đến / đi / ở qua đêm, ca quá tải và kênh lỗi đồng bộ. Mọi con số là số máy chủ đếm (`total`), không
 * dựng lại từ danh sách booking; danh sách bị cắt ở 200 dòng thì nói rõ.
 */
import type { ReactElement } from 'react';
import Link from 'next/link';
import { isApiError } from '@pinehill/api-client';
import type { DayBoard, DayBoardBooking } from '@pinehill/contracts';
import { formatDateTimeVn, formatMoney } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_SUBTITLE_STYLE,
  OPS_TABLE_WRAP_STYLE,
  OPS_TABULAR_STYLE,
  opsNoticeStyle,
} from '../../../components/editorial-styles';
import { t } from '../../../lib/i18n';
import { STATUS_KEYS } from '../bookings/bookings-model';
import { dayText } from './messages';
import { orderGroup, pendingCount, type DayRow } from './model';

type GroupKind = 'arrivals' | 'departures' | 'inHouse';

const GROUPS: readonly {
  kind: GroupKind;
  title: 'arrivalsTitle' | 'departuresTitle' | 'inHouseTitle';
  empty: 'arrivalsEmpty' | 'departuresEmpty' | 'inHouseEmpty';
}[] = [
  { kind: 'arrivals', title: 'arrivalsTitle', empty: 'arrivalsEmpty' },
  { kind: 'departures', title: 'departuresTitle', empty: 'departuresEmpty' },
  { kind: 'inHouse', title: 'inHouseTitle', empty: 'inHouseEmpty' },
];

/** `dd/mm` từ ngày nghiệp vụ `YYYY-MM-DD` (không qua Date để không lệch múi giờ). */
function shortDay(value: string): string {
  const [, month, day] = value.split('-');
  return `${day}/${month}`;
}

function longDay(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function DayBoardSection({
  board,
  error,
  rows,
  onRetry,
}: {
  board: DayBoard | null | undefined;
  error: unknown;
  rows: readonly DayRow[];
  onRetry: () => void;
}): ReactElement | null {
  if (!board) {
    if (!error) return null;
    const denied = isApiError(error) && error.status === 403;
    return (
      <div data-testid="day-board-error" role="status" style={opsNoticeStyle('warning')}>
        <p style={{ margin: 0 }}>{dayText(denied ? 'boardDenied' : 'boardFailed')}</p>
        {denied ? null : (
          <div className="ph-actions">
            <button type="button" className="ph-btn" onClick={onRetry}>
              {dayText('boardRetry')}
            </button>
          </div>
        )}
      </div>
    );
  }
  const typeCode = (id: string) => rows.find((row) => row.roomTypeId === id)?.code ?? id;
  return (
    <>
      <DayStats board={board} />
      {GROUPS.map((group) => (
        <GuestGroup
          key={group.kind}
          kind={group.kind}
          title={dayText(group.title)}
          empty={dayText(group.empty)}
          group={board[group.kind]}
          typeCode={typeCode}
        />
      ))}
      <div className="ph-day-pair">
        <CasesPanel board={board} />
        <ChannelsPanel board={board} />
      </div>
    </>
  );
}

function DayStats({ board }: { board: DayBoard }): ReactElement {
  const arrivalsPending = pendingCount('arrivals', board.arrivals.items);
  const departuresPending = pendingCount('departures', board.departures.items);
  const stats: readonly {
    id: string;
    href: string;
    label: string;
    value: number;
    note?: string;
    alert?: boolean;
  }[] = [
    {
      id: 'arrivals',
      href: '#day-arrivals',
      label: dayText('statArrivals'),
      value: board.arrivals.total,
      ...(board.arrivals.truncated
        ? {}
        : { note: dayText('statPending', { count: arrivalsPending }) }),
    },
    {
      id: 'departures',
      href: '#day-departures',
      label: dayText('statDepartures'),
      value: board.departures.total,
      ...(board.departures.truncated
        ? {}
        : { note: dayText('statPending', { count: departuresPending }) }),
    },
    {
      id: 'inHouse',
      href: '#day-inHouse',
      label: dayText('statInHouse'),
      value: board.inHouse.total,
    },
    {
      id: 'cases',
      href: '/overbooking/cases',
      label: dayText('statCases'),
      value: board.overbooking.onDate,
      note: dayText('statCasesFrom', { count: board.overbooking.openFromDate }),
      alert: board.overbooking.onDate > 0,
    },
    {
      id: 'channels',
      href: '/channels/sync',
      label: dayText('statChannels'),
      value: board.degradedChannels.length,
      alert: board.degradedChannels.length > 0,
    },
  ];
  return (
    <nav aria-label={dayText('summary')} className="ph-day-stats" data-testid="day-stats">
      {stats.map((stat) => (
        <a
          key={stat.id}
          href={stat.href}
          className="ph-day-stat"
          data-alert={stat.alert ? 'true' : undefined}
          data-testid={`day-stat-${stat.id}`}
        >
          <span className="ph-day-stat-label">{stat.label}</span>
          <span className="ph-day-stat-value">{stat.value}</span>
          {stat.note ? <span className="ph-day-stat-note">{stat.note}</span> : null}
        </a>
      ))}
    </nav>
  );
}

function GuestGroup({
  kind,
  title,
  empty,
  group,
  typeCode,
}: {
  kind: GroupKind;
  title: string;
  empty: string;
  group: DayBoard['arrivals'];
  typeCode: (id: string) => string;
}): ReactElement {
  const items = orderGroup(kind, group.items);
  const headingId = `day-${kind}-title`;
  return (
    <section
      id={`day-${kind}`}
      aria-labelledby={headingId}
      data-testid={`day-group-${kind}`}
      style={{ display: 'grid', gap: 8, scrollMarginTop: 72 }}
    >
      <h2 id={headingId} style={OPS_SUBTITLE_STYLE}>
        {title} <span style={OPS_TABULAR_STYLE}>({group.total})</span>
      </h2>
      {items.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--color-textMuted)' }}>{empty}</p>
      ) : (
        <div style={OPS_TABLE_WRAP_STYLE}>
          <table className="ph-day-table" style={OPS_TABULAR_STYLE}>
            <thead>
              <tr>
                <th scope="col">{dayText('colCode')}</th>
                <th scope="col">{dayText('colGuest')}</th>
                <th scope="col">{dayText('colType')}</th>
                <th scope="col">{dayText('colStay')}</th>
                <th scope="col">{dayText('colChannel')}</th>
                <th scope="col">{dayText('colStatus')}</th>
                <th scope="col" className="ph-day-money">
                  {dayText('colBalance')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <GuestRow key={item.bookingId} item={item} typeCode={typeCode} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {group.truncated ? (
        <p data-testid={`day-truncated-${kind}`} style={{ margin: 0, fontSize: 13 }}>
          {dayText('truncated', { shown: items.length, total: group.total })}{' '}
          <Link href="/bookings">{t('ops.nav.bookings')}</Link>
        </p>
      ) : null}
    </section>
  );
}

function GuestRow({
  item,
  typeCode,
}: {
  item: DayBoardBooking;
  typeCode: (id: string) => string;
}): ReactElement {
  return (
    <tr data-testid={`day-booking-${item.code}`}>
      <th scope="row" className="ph-day-code">
        <Link href={`/bookings/${encodeURIComponent(item.bookingId)}`}>{item.code}</Link>
      </th>
      <td data-label={dayText('colGuest')}>{item.guestName}</td>
      <td data-label={dayText('colType')}>
        {typeCode(item.roomTypeId)}
        {item.roomCount > 1 ? ` × ${item.roomCount}` : ''}
      </td>
      <td data-label={dayText('colStay')}>
        {shortDay(item.checkIn)} → {shortDay(item.checkOut)}
      </td>
      <td data-label={dayText('colChannel')}>{item.channelCode}</td>
      <td data-label={dayText('colStatus')}>{t(STATUS_KEYS[item.status])}</td>
      <td
        data-label={dayText('colBalance')}
        className="ph-day-money"
        data-due={item.balanceDue > 0 ? 'true' : undefined}
      >
        {formatMoney(item.balanceDue)}
      </td>
    </tr>
  );
}

function CasesPanel({ board }: { board: DayBoard }): ReactElement {
  const { onDate, openFromDate } = board.overbooking;
  return (
    <section
      data-testid="day-cases"
      className="ph-card"
      style={{ display: 'grid', gap: 12, alignContent: 'start' }}
    >
      <h2 style={OPS_SUBTITLE_STYLE}>{dayText('casesTitle')}</h2>
      <p style={{ margin: 0 }}>
        {openFromDate === 0
          ? dayText('casesNone')
          : dayText('casesBody', { onDate, date: longDay(board.date), openFrom: openFromDate })}
      </p>
      <div className="ph-actions">
        <Link
          href="/overbooking/cases"
          className={onDate > 0 ? 'ph-btn-primary' : 'ph-btn'}
          style={OPS_COMPACT_BTN_STYLE}
        >
          {dayText('casesOpen')}
        </Link>
      </div>
    </section>
  );
}

function ChannelsPanel({ board }: { board: DayBoard }): ReactElement {
  return (
    <section
      data-testid="day-channels"
      className="ph-card"
      style={{ display: 'grid', gap: 12, alignContent: 'start' }}
    >
      <h2 style={OPS_SUBTITLE_STYLE}>{dayText('channelsTitle')}</h2>
      {board.degradedChannels.length === 0 ? (
        <p style={{ margin: 0 }}>{dayText('channelsNone')}</p>
      ) : (
        <ul className="ph-list-lines">
          {board.degradedChannels.map((channel) => (
            <li key={channel.channelId} data-testid={`day-channel-${channel.code}`}>
              <strong>
                {channel.name} ({channel.code})
              </strong>
              <span style={{ fontSize: 13, textAlign: 'right' }}>
                {dayText('channelFailures', { count: channel.consecutiveFailures })} ·{' '}
                {channel.lastSyncAt
                  ? dayText('channelLastSync', { time: formatDateTimeVn(channel.lastSyncAt) })
                  : dayText('channelNeverSynced')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="ph-actions">
        <Link
          href="/channels/sync"
          className={board.degradedChannels.length > 0 ? 'ph-btn-primary' : 'ph-btn'}
          style={OPS_COMPACT_BTN_STYLE}
        >
          {dayText('channelsOpen')}
        </Link>
      </div>
    </section>
  );
}
