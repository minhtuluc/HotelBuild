'use client';

/**
 * SCR-10 — chi tiết booking của tôi (UC-BOOK-07): đọc lại booking **và** số dư từ máy chủ, hiện lối vào
 * các thao tác huỷ/đổi ngày (SCR-11/SCR-12).
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
  type ScreenState,
} from '@pinehill/ui-web';
import { t } from '../../../../lib/i18n';
import { fetchBookingBalance } from '../api';
import { fetchBooking } from '../../booking/booking-api';
import { STATUS_KEYS, balanceRows, stayText, type BalanceRow } from '../model';
import { formatCountdown, holdView, type HoldView } from '../../booking/booking-model';

const BALANCE_KEYS: Readonly<Record<BalanceRow['key'], Parameters<typeof t>[0]>> = {
  total: 'guest.bookings.balance.total',
  paid: 'guest.bookings.balance.paid',
  refunded: 'guest.bookings.balance.refunded',
  reservedRefund: 'guest.bookings.balance.reservedRefund',
  due: 'guest.bookings.balance.due',
};

function BalancePanel({ balance }: { balance: BookingBalance }): ReactElement {
  return (
    <div className="ph-table-wrap">
      <table data-testid="booking-detail-balance">
        <caption
          style={{
            textAlign: 'start',
            padding: '14px 16px',
            fontFamily: 'var(--font-display)',
            fontSize: 18,
          }}
        >
          {t('guest.bookings.balance.title')}
        </caption>
        <tbody>
          {balanceRows(balance).map((row) => (
            <tr key={row.key}>
              <th scope="row">{t(BALANCE_KEYS[row.key])}</th>
              <td className="ph-tabular" style={{ fontWeight: row.key === 'due' ? 500 : 400 }}>
                {formatMoney(row.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bảng "Kỳ lưu trú" của SCR-10: ngày nhận/trả là ngày lịch `dd/MM/yyyy` qua helper `stayText`. */
export function StayPanel({
  booking,
  hold,
}: {
  booking: BookingSummary;
  hold: HoldView | null;
}): ReactElement {
  return (
    <div className="ph-table-wrap">
      <table data-testid="booking-detail-stay">
        <caption
          style={{
            textAlign: 'start',
            padding: '14px 16px',
            fontFamily: 'var(--font-display)',
            fontSize: 18,
          }}
        >
          {t('guest.booking.stay')}
        </caption>
        <tbody>
          <tr>
            <th scope="row">{t('guest.booking.stay.period')}</th>
            <td className="ph-tabular">{stayText(booking)}</td>
          </tr>
          <tr>
            <th scope="row">{t('guest.booking.stay.rooms')}</th>
            <td className="ph-tabular">{booking.roomCount}</td>
          </tr>
          <tr>
            <th scope="row">{t('guest.booking.created')}</th>
            <td className="ph-tabular">{formatDateTimeVn(booking.createdAt)}</td>
          </tr>
          {hold === null || hold.kind !== 'active' ? null : (
            <tr>
              <th scope="row">{t('guest.bookings.col.hold')}</th>
              <td className="ph-tabular" data-testid="booking-detail-hold">
                {formatCountdown(hold.remainingMs)}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DetailActions({ bookingId }: { bookingId: string }): ReactElement {
  return (
    <div
      data-testid="booking-detail-actions"
      style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}
    >
      <Link href={`/bookings/${bookingId}/cancel`} className="ph-btn">
        {t('guest.bookings.action.cancel')}
      </Link>
      <Link href={`/bookings/${bookingId}/reschedule`} className="ph-btn">
        {t('guest.bookings.action.reschedule')}
      </Link>
      <Link href={`/booking/${bookingId}`} className="ph-btn-primary">
        {t('guest.bookings.action.hold')}
      </Link>
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
      if (status === 403) setState({ kind: 'forbidden' });
      else if (status === 404) {
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

  if (state.kind === 'forbidden')
    return (
      <div className="ph-page-shell">
        <AccessDeniedPanel backHref="/bookings" />
      </div>
    );

  if (notFound) {
    return (
      <section role="alert" data-testid="booking-detail-not-found" className="ph-page-shell">
        <div className="ph-page-header">
          <h1 className="ph-page-title">{t('guest.bookings.detail.title')}</h1>
        </div>
        <div className="ph-alert-box">
          <p style={{ margin: 0 }}>{t('guest.booking.notFound')}</p>
          <Link href="/bookings" className="ph-btn">
            {t('guest.bookings.back')}
          </Link>
        </div>
      </section>
    );
  }

  const hold = booking === null ? null : holdView(booking, Date.now());

  return (
    <section data-testid="booking-detail" className="ph-page-shell">
      <div className="ph-page-header">
        <h1 className="ph-page-title">{t('guest.bookings.detail.title')}</h1>
      </div>
      <StateSurface state={state}>
        {readError ? (
          <div role="alert" data-testid="booking-detail-alert" className="ph-alert-box">
            <p style={{ margin: 0 }}>{t('guest.bookings.error')}</p>
            <button
              type="button"
              data-testid="booking-detail-retry"
              className="ph-btn"
              onClick={() => void load()}
            >
              {t('guest.results.retry')}
            </button>
          </div>
        ) : null}
        {booking === null ? (
          <div>
            <Link href="/bookings" className="ph-btn">
              {t('guest.bookings.back')}
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 20 }}>
            <div
              className="ph-card"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <p data-testid="booking-detail-code" style={{ margin: 0 }}>
                <code
                  className="ph-tabular"
                  style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}
                >
                  {booking.code}
                </code>
              </p>
              <p data-testid="booking-detail-status" style={{ margin: 0, fontWeight: 500 }}>
                {formatStatusWithEnum(t(STATUS_KEYS[booking.status]), booking.status)}
              </p>
            </div>
            <div className="ph-two-col">
              <StayPanel booking={booking} hold={hold} />
              {balance === null ? null : <BalancePanel balance={balance} />}
            </div>
            <p
              className="ph-muted-box"
              style={{ margin: 0, fontSize: 14 }}
              data-testid="booking-detail-pending"
            >
              {t('guest.bookings.detail.pending')}
            </p>
            <DetailActions bookingId={bookingId} />
          </div>
        )}
      </StateSurface>
    </section>
  );
}
