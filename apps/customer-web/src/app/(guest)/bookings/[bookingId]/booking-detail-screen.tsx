'use client';

/**
 * SCR-10 — chi tiết booking của tôi (UC-BOOK-07): đọc lại booking **và** số dư từ máy chủ, hiện lối vào
 * các thao tác huỷ/đổi ngày (SCR-11/SCR-12 — ticket riêng).
 *
 * Phạm vi dữ liệu (HB-102, chủ dự án đã duyệt): hợp đồng hiện chỉ có `bookings/{id}` + `bookings/{id}/balance`,
 * **chưa** có PriceSnapshot từng đêm, danh sách Payment và RoomAssignment. Màn hình nói rõ phần chưa có
 * thay vì bịa số liệu.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createSessionClient } from '@pinehill/web-session/client';
import { isApiError } from '@pinehill/api-client';
import type { BookingBalance, BookingSummary } from '@pinehill/contracts';
import {
  AccessDeniedPanel,
  StateSurface,
  formatDateTimeVn,
  formatMoney,
  formatStatusWithEnum,
  formatStayPeriod,
  type ScreenState,
} from '@pinehill/ui-web';
import { t } from '../../../../lib/i18n';
import { fetchBookingBalance } from '../api';
import { fetchBooking } from '../../booking/booking-api';
import { STATUS_KEYS, balanceRows, type BalanceRow } from '../model';
import { formatCountdown, holdView } from '../../booking/booking-model';

const CELL = { padding: '4px 12px 4px 0', textAlign: 'left' } as const;

const BALANCE_KEYS: Readonly<Record<BalanceRow['key'], Parameters<typeof t>[0]>> = {
  total: 'guest.bookings.balance.total',
  paid: 'guest.bookings.balance.paid',
  refunded: 'guest.bookings.balance.refunded',
  reservedRefund: 'guest.bookings.balance.reservedRefund',
  due: 'guest.bookings.balance.due',
};

function BalancePanel({ balance }: { balance: BookingBalance }): ReactElement {
  return (
    <table data-testid="booking-detail-balance">
      <caption style={{ textAlign: 'left', paddingBottom: 4 }}>
        {t('guest.bookings.balance.title')}
      </caption>
      <tbody>
        {balanceRows(balance).map((row) => (
          <tr key={row.key}>
            <th scope="row" style={CELL}>
              {t(BALANCE_KEYS[row.key])}
            </th>
            <td style={CELL}>{formatMoney(row.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailActions({ bookingId }: { bookingId: string }): ReactElement {
  return (
    <div data-testid="booking-detail-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Link href={`/bookings/${bookingId}/cancel`}>{t('guest.bookings.action.cancel')}</Link>
      <Link href={`/bookings/${bookingId}/reschedule`}>
        {t('guest.bookings.action.reschedule')}
      </Link>
      <Link href={`/booking/${bookingId}`}>{t('guest.bookings.action.hold')}</Link>
    </div>
  );
}

export function BookingDetailScreen(): ReactElement {
  const routeParams = useParams<{ bookingId: string }>();
  const bookingId = typeof routeParams.bookingId === 'string' ? routeParams.bookingId : '';

  const session = useMemo(() => createSessionClient({ kind: 'guest' }), []);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [balance, setBalance] = useState<BookingBalance | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [readError, setReadError] = useState(false);

  useEffect(() => () => session.dispose(), [session]);

  const load = useCallback(async (): Promise<void> => {
    setReadError(false);
    setNotFound(false);
    setState({ kind: 'loading' });
    try {
      // Booking và số dư đọc song song từ hai tuyến cần phiên khách (máy chủ vẫn là nơi giới hạn chủ thể).
      const [loaded, loadedBalance] = await Promise.all([
        fetchBooking(session, bookingId),
        fetchBookingBalance(session, bookingId),
      ]);
      setBooking(loaded);
      setBalance(loadedBalance);
      setNotFound(false);
      setState({ kind: 'ready' });
    } catch (caught) {
      const status = isApiError(caught) ? caught.status : undefined;
      setBooking(null);
      setBalance(null);
      if (status === 403) {
        setState({ kind: 'forbidden' });
      } else if (status === 404) {
        setNotFound(true);
        setState({ kind: 'ready' });
      } else {
        setReadError(true);
        setState({ kind: 'ready' });
      }
    }
  }, [bookingId, session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'forbidden') return <AccessDeniedPanel backHref="/bookings" />;

  if (notFound) {
    return (
      <section
        role="alert"
        data-testid="booking-detail-not-found"
        style={{
          display: 'grid',
          gap: 'var(--space-s3, 12px)',
          padding: 'var(--space-s4, 16px) 0',
        }}
      >
        <h1 style={{ margin: 0 }}>{t('guest.bookings.detail.title')}</h1>
        <p style={{ margin: 0 }}>{t('guest.booking.notFound')}</p>
        <Link href="/bookings">{t('guest.bookings.back')}</Link>
      </section>
    );
  }

  const hold = booking === null ? null : holdView(booking, Date.now());

  return (
    <section
      data-testid="booking-detail"
      style={{ display: 'grid', gap: 'var(--space-s3, 12px)', padding: 'var(--space-s4, 16px) 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('guest.bookings.detail.title')}</h1>
      <StateSurface state={state}>
        {readError ? (
          <div role="alert" data-testid="booking-detail-alert" style={{ display: 'grid', gap: 8 }}>
            <p style={{ margin: 0 }}>{t('guest.bookings.error')}</p>
            <button type="button" data-testid="booking-detail-retry" onClick={() => void load()}>
              {t('guest.results.retry')}
            </button>
          </div>
        ) : null}
        {booking === null ? (
          <Link href="/bookings">{t('guest.bookings.back')}</Link>
        ) : (
          <>
            <p data-testid="booking-detail-code" style={{ margin: 0 }}>
              <code style={{ fontSize: 'var(--text-h2, 20px)' }}>{booking.code}</code>
            </p>
            <p data-testid="booking-detail-status" style={{ margin: 0 }}>
              {formatStatusWithEnum(t(STATUS_KEYS[booking.status]), booking.status)}
            </p>
            <table data-testid="booking-detail-stay">
              <caption style={{ textAlign: 'left', paddingBottom: 4 }}>
                {t('guest.booking.stay')}
              </caption>
              <tbody>
                <tr>
                  <th scope="row" style={CELL}>
                    {t('guest.booking.stay.period')}
                  </th>
                  <td style={CELL}>
                    {booking.checkIn} → {booking.checkOut} ·{' '}
                    {formatStayPeriod(booking.nights, booking.adults, booking.children)}
                  </td>
                </tr>
                <tr>
                  <th scope="row" style={CELL}>
                    {t('guest.booking.stay.rooms')}
                  </th>
                  <td style={CELL}>{booking.roomCount}</td>
                </tr>
                <tr>
                  <th scope="row" style={CELL}>
                    {t('guest.booking.created')}
                  </th>
                  <td style={CELL}>{formatDateTimeVn(booking.createdAt)}</td>
                </tr>
                {hold === null || hold.kind !== 'active' ? null : (
                  <tr>
                    <th scope="row" style={CELL}>
                      {t('guest.bookings.col.hold')}
                    </th>
                    <td style={CELL} data-testid="booking-detail-hold">
                      {formatCountdown(hold.remainingMs)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {balance === null ? null : <BalancePanel balance={balance} />}
            <p style={{ margin: 0 }} data-testid="booking-detail-pending">
              {t('guest.bookings.detail.pending')}
            </p>
            <DetailActions bookingId={bookingId} />
          </>
        )}
      </StateSurface>
    </section>
  );
}
