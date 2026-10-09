'use client';

/** Phần trình bày của SCR-31/SCR-32 (HB-106): bộ lọc, bảng booking, dòng tiền, khối xoá cứng. */
import Link from 'next/link';
import type { ReactElement } from 'react';
import { formatMoney, formatStatusWithEnum } from '@pinehill/ui-web';
import { bookingStatusSchema } from '@pinehill/contracts';
import type { BookingStatus, BookingSummary } from '@pinehill/contracts';
import { t } from '../../../lib/i18n';
import {
  STATUS_KEYS,
  balanceRows,
  canHardDelete,
  stayOf,
  type BookingFilters,
} from './bookings-model';

const CELL = { padding: '4px 12px 4px 0', textAlign: 'left' } as const;

export function statusLabel(status: BookingStatus): string {
  return formatStatusWithEnum(t(STATUS_KEYS[status]), status);
}

export function FilterForm({
  current,
  onApply,
}: {
  current: BookingFilters;
  onApply: (filters: BookingFilters) => void;
}): ReactElement {
  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const status = bookingStatusSchema.safeParse(String(data.get('status') ?? ''));
    onApply({
      propertyId: String(data.get('propertyId') ?? '').trim(),
      status: status.success ? status.data : '',
      channelCode: String(data.get('channelCode') ?? '').trim(),
      q: String(data.get('q') ?? '').trim(),
      from: String(data.get('from') ?? '').trim(),
      to: String(data.get('to') ?? '').trim(),
    });
  };
  return (
    <form
      data-testid="bookings-filters"
      onSubmit={submit}
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}
    >
      <label style={{ display: 'grid', gap: 4 }}>
        {t('ops.bookings.filter.propertyId')}
        <input name="propertyId" defaultValue={current.propertyId} />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('ops.bookings.filter.status')}
        <select name="status" defaultValue={current.status}>
          <option value="">{t('ops.bookings.filter.all')}</option>
          {bookingStatusSchema.options.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('ops.bookings.filter.channelCode')}
        <input name="channelCode" defaultValue={current.channelCode} />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('ops.bookings.filter.q')}
        <input name="q" type="search" defaultValue={current.q} />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('ops.bookings.filter.from')}
        <input name="from" type="date" defaultValue={current.from} />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('ops.bookings.filter.to')}
        <input name="to" type="date" defaultValue={current.to} />
      </label>
      <button type="submit">{t('ops.bookings.filter.apply')}</button>
      <button
        type="button"
        onClick={() => {
          onApply({ propertyId: '', status: '', channelCode: '', q: '', from: '', to: '' });
        }}
      >
        {t('ops.bookings.filter.clear')}
      </button>
    </form>
  );
}

export function MoneyCell({ booking }: { booking: BookingSummary }): ReactElement {
  return (
    <td style={CELL}>
      {balanceRows(booking).map((row) => (
        <span key={row.key} style={{ marginRight: 8 }}>
          {t(row.key === 'paid' ? 'ops.bookings.col.paid' : 'ops.bookings.col.balance')}:{' '}
          {formatMoney(row.amount)}
        </span>
      ))}
    </td>
  );
}

export function BookingsTable({
  bookings,
  onDelete,
}: {
  bookings: readonly BookingSummary[];
  onDelete: (booking: BookingSummary) => void;
}): ReactElement {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="bookings-list">
        <caption style={{ textAlign: 'left', paddingBottom: 4 }}>{t('ops.bookings.table')}</caption>
        <thead>
          <tr>
            <th scope="col" style={CELL}>
              {t('ops.bookings.col.code')}
            </th>
            <th scope="col" style={CELL}>
              {t('ops.bookings.col.property')}
            </th>
            <th scope="col" style={CELL}>
              {t('ops.bookings.col.channel')}
            </th>
            <th scope="col" style={CELL}>
              {t('ops.bookings.col.status')}
            </th>
            <th scope="col" style={CELL}>
              {t('ops.bookings.col.stay')}
            </th>
            <th scope="col" style={CELL}>
              {t('ops.bookings.col.money')}
            </th>
            <th scope="col" style={CELL}>
              {t('ops.bookings.col.action')}
            </th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((booking) => (
            <tr key={booking.id} data-testid={`booking-row-${booking.code}`}>
              <td style={CELL}>
                <Link href={`/bookings/${booking.id}`}>{booking.code}</Link>
              </td>
              <td style={CELL}>{booking.propertyId}</td>
              <td style={CELL}>{booking.channelId}</td>
              <td style={CELL}>{statusLabel(booking.status)}</td>
              <td style={CELL}>{stayOf(booking)}</td>
              <MoneyCell booking={booking} />
              <td style={CELL}>
                {canHardDelete(booking.status) ? (
                  <button
                    type="button"
                    data-testid={`booking-delete-open-${booking.code}`}
                    onClick={() => onDelete(booking)}
                  >
                    {t('ops.bookings.delete.open')}
                  </button>
                ) : (
                  t('ops.bookings.delete.notAllowed')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeletePanel({
  booking,
  reason,
  onReason,
  onConfirm,
  onCancel,
  busy,
}: {
  booking: BookingSummary;
  reason: string;
  onReason: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <section
      role="alertdialog"
      aria-labelledby="ops-bookings-delete-title"
      data-testid="booking-delete-panel"
      style={{ display: 'grid', gap: 8, border: '1px solid var(--color-danger)', padding: 16 }}
    >
      <h2 id="ops-bookings-delete-title" style={{ margin: 0 }}>
        {t('ops.bookings.delete.title', { code: booking.code })}
      </h2>
      <p style={{ margin: 0 }}>{t('ops.bookings.delete.note')}</p>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('ops.bookings.delete.reason')}
        <input
          name="deleteReason"
          value={reason}
          onChange={(event) => {
            onReason(event.target.value);
          }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          data-testid="booking-delete-confirm"
          disabled={busy || reason.trim() === ''}
          onClick={onConfirm}
        >
          {t('ops.bookings.delete.confirm')}
        </button>
        <button type="button" onClick={onCancel}>
          {t('ops.bookings.delete.cancel')}
        </button>
      </div>
    </section>
  );
}
