'use client';

/**
 * SCR-32 — chi tiết booking cho back-office (UC-BOOK-07, BR-BOOK-17, BR-RBAC-02).
 *
 * Hợp đồng hiện chỉ có `GET /bookings/{id}` trả `bookingSummarySchema`: màn hình in đúng những gì máy chủ
 * trả và để **khung chờ** cho hai phần thiết kế §8.1 yêu cầu nhưng hợp đồng chưa có (bảng giá theo đêm,
 * danh sách khoản thanh toán) — không bịa số. Ngoài phạm vi cơ sở thì báo đúng câu chữ BR-RBAC-02.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createBookingApi, isApiError } from '@pinehill/api-client';
import type { BookingSummary } from '@pinehill/contracts';
import { StateSurface, formatDateTimeVn, formatMoney, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../../components/screen-alert';
import { useForcedState } from '../../../../components/forced-state';
import { opsApiClient } from '../../../../lib/api';
import { t } from '../../../../lib/i18n';
import { readFailureState } from '../../../../lib/screen-state';
import { balanceRows, stayOf } from '../bookings-model';
import { statusLabel } from '../bookings-parts';

const CELL = { padding: '4px 12px 4px 0', textAlign: 'left' } as const;

function Summary({ booking }: { booking: BookingSummary }): ReactElement {
  return (
    <table data-testid="booking-detail">
      <caption style={{ textAlign: 'left', paddingBottom: 4 }}>
        {t('ops.bookings.detail.summary')}
      </caption>
      <tbody>
        <tr>
          <th scope="row" style={CELL}>
            {t('ops.bookings.col.code')}
          </th>
          <td style={CELL}>
            <code data-testid="booking-detail-code">{booking.code}</code>
          </td>
        </tr>
        <tr>
          <th scope="row" style={CELL}>
            {t('ops.bookings.col.status')}
          </th>
          <td style={CELL} data-testid="booking-detail-status">
            {statusLabel(booking.status)}
          </td>
        </tr>
        <tr>
          <th scope="row" style={CELL}>
            {t('ops.bookings.col.stay')}
          </th>
          <td style={CELL}>{stayOf(booking)}</td>
        </tr>
        <tr>
          <th scope="row" style={CELL}>
            {t('ops.bookings.col.property')}
          </th>
          <td style={CELL}>{booking.propertyId}</td>
        </tr>
        <tr>
          <th scope="row" style={CELL}>
            {t('ops.bookings.col.channel')}
          </th>
          <td style={CELL}>{booking.channelId}</td>
        </tr>
        <tr>
          <th scope="row" style={CELL}>
            {t('ops.bookings.col.money')}
          </th>
          <td style={CELL} data-testid="booking-detail-money">
            {balanceRows(booking).map((row) => (
              <span key={row.key} style={{ marginRight: 8 }}>
                {t(row.key === 'paid' ? 'ops.bookings.col.paid' : 'ops.bookings.col.balance')}:{' '}
                {formatMoney(row.amount)}
              </span>
            ))}
          </td>
        </tr>
        <tr>
          <th scope="row" style={CELL}>
            {t('ops.bookings.detail.created')}
          </th>
          <td style={CELL}>
            {formatDateTimeVn(booking.createdAt)} · {booking.createdBy}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function BookingScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const params = useParams<{ bookingId: string }>();
  const bookingId = typeof params.bookingId === 'string' ? params.bookingId : '';

  const api = useMemo(() => createBookingApi(opsApiClient(baseUrl)), [baseUrl]);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const [outOfScope, setOutOfScope] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setNotFound(false);
    setOutOfScope(false);
    setState({ kind: 'loading' });
    try {
      setBooking((await api.get(bookingId)).data);
      setState({ kind: 'ready' });
    } catch (caught) {
      setBooking(null);
      setState({ kind: 'ready' });
      if (isApiError(caught) && caught.status === 404) {
        setNotFound(true);
        return;
      }
      if (isApiError(caught) && caught.code === 'E_AUTH_OUT_OF_SCOPE') {
        setOutOfScope(true);
        return;
      }
      const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
      if (mapped !== undefined) {
        setState(mapped);
        return;
      }
      setError(caught);
    }
  }, [api, bookingId]);

  useEffect(() => {
    if (forced !== undefined) return;
    void load();
  }, [forced, load]);

  if (forced !== undefined) {
    return (
      <section data-testid="booking-screen" style={{ display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{t('ops.bookings.detail.title')}</h1>
        <StateSurface state={forced} />
      </section>
    );
  }

  return (
    <section data-testid="booking-screen" style={{ display: 'grid', gap: 12, padding: '16px 0' }}>
      <h1 style={{ margin: 0 }}>{t('ops.bookings.detail.title')}</h1>
      <StateSurface state={state}>
        {error === null ? null : <ScreenAlert error={error} onRetry={() => void load()} />}
        {!notFound ? null : (
          <div role="alert" data-testid="booking-not-found" style={{ display: 'grid', gap: 8 }}>
            <p style={{ margin: 0 }}>{t('ops.bookings.detail.notFound')}</p>
            <Link href="/bookings">{t('ops.bookings.detail.lookup')}</Link>
          </div>
        )}
        {!outOfScope ? null : (
          <div role="alert" data-testid="booking-out-of-scope" style={{ display: 'grid', gap: 8 }}>
            <p style={{ margin: 0 }}>{t('ops.bookings.detail.outOfScope')}</p>
            <Link href="/bookings">{t('ops.bookings.detail.back')}</Link>
          </div>
        )}
        {booking === null ? null : (
          <>
            <Summary booking={booking} />
            <p style={{ margin: 0 }} data-testid="booking-nights-pending">
              {t('ops.bookings.detail.nightsPending')}
            </p>
            <p style={{ margin: 0 }} data-testid="booking-payments-pending">
              {t('ops.bookings.detail.paymentsPending')}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href={`/bookings/${bookingId}/cancel`} data-testid="booking-open-cancel">
                {t('ops.bookings.action.cancel')}
              </Link>
              <Link
                href={`/bookings/${bookingId}/reschedule`}
                data-testid="booking-open-reschedule"
              >
                {t('ops.bookings.action.reschedule')}
              </Link>
              <Link href={`/bookings/${bookingId}/collect`} data-testid="booking-open-collect">
                {t('ops.bookings.action.collect')}
              </Link>
            </div>
            <Link href={`/bookings/${bookingId}/refunds`} data-testid="booking-open-refunds">
              {t('ops.refunds.title')}
            </Link>
            <p style={{ margin: 0 }} data-testid="booking-actions-pending">
              {t('ops.bookings.detail.actionsPending')}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" data-testid="booking-reload" onClick={() => void load()}>
                {t('ops.bookings.detail.reload')}
              </button>
              <Link href="/bookings">{t('ops.bookings.detail.back')}</Link>
            </div>
          </>
        )}
      </StateSurface>
    </section>
  );
}
