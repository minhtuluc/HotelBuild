'use client';

/**
 * SCR-35 (HB-108) — đổi ngày booking cho back-office.
 *
 * Báo giá kỳ mới (`POST /quotes`) để **hiện chênh lệch trước khi xác nhận**, rồi `POST /bookings/{id}/reschedule`
 * (giữ `PriceSnapshot` cũ, **không** đổi trạng thái — BR-BOOK-12/13). Hợp đồng chưa có trường phí đổi ngày
 * (`Payment RESCHEDULE_FEE` cho gói NONREF) nên màn hình ghi rõ phần chờ, không bịa số.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';
import { createBookingApi, createQuoteApi } from '@pinehill/api-client';
import { ratePlanCodeSchema } from '@pinehill/contracts';
import type { BookingSummary, Quote } from '@pinehill/contracts';
import { StateSurface, formatMoney, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../../../components/screen-alert';
import { useForcedState } from '../../../../../components/forced-state';
import { useOpsSession } from '../../../../../lib/ops-session';
import { formatBusinessDate } from '../../../../../lib/business-date';
import { t } from '../../../../../lib/i18n';
import { writeFailureState } from '../../../../../lib/screen-state';
import { quoteRequestOf, rescheduleRequestOf, stayDifference } from '../cancel/cancel-model';

function Difference({ booking, quote }: { booking: BookingSummary; quote: Quote }): ReactElement {
  const difference = stayDifference(quote.total, booking.totalAmount);
  const key =
    difference.kind === 'more'
      ? 'ops.reschedule.diff.more'
      : difference.kind === 'less'
        ? 'ops.reschedule.diff.less'
        : 'ops.reschedule.diff.same';
  return (
    <section data-testid="reschedule-diff" style={{ display: 'grid', gap: 8 }}>
      <h2 style={{ margin: 0 }}>{t('ops.reschedule.diff.title')}</h2>
      <p style={{ margin: 0 }} data-testid="reschedule-new-total">
        {t('ops.reschedule.diff.newTotal', { amount: formatMoney(quote.total) })}
      </p>
      <p style={{ margin: 0 }}>
        {t('ops.reschedule.diff.currentTotal', { amount: formatMoney(booking.totalAmount) })}
      </p>
      <p style={{ margin: 0 }} data-testid="reschedule-difference">
        {t(key, { amount: formatMoney(difference.amount) })}
      </p>
      <p style={{ margin: 0 }} data-testid="reschedule-fee-gap">
        {t('ops.reschedule.feePending')}
      </p>
    </section>
  );
}

export function RescheduleBookingScreen(): ReactElement {
  const forced = useForcedState();
  const params = useParams<{ bookingId: string }>();
  const bookingId = typeof params.bookingId === 'string' ? params.bookingId : '';
  const session = useOpsSession(['/bookings', '/quotes'], {
    onExpired: () => setState({ kind: 'forbidden' }),
  });
  const api = useMemo(
    () => ({
      bookings: createBookingApi(session.client),
      quotes: createQuoteApi(session.client),
    }),
    [session],
  );

  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [reason, setReason] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [updated, setUpdated] = useState<BookingSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setState({ kind: 'loading' });
    try {
      const loaded = (await api.bookings.get(bookingId)).data;
      setBooking(loaded);
      setCheckIn(loaded.checkIn);
      setCheckOut(loaded.checkOut);
      setState({ kind: 'ready' });
    } catch (caught) {
      setState({ kind: 'ready' });
      setError(caught);
    }
  }, [api, bookingId]);

  useEffect(() => {
    if (forced !== undefined) return;
    void load();
  }, [forced, load]);

  const checkPrice = useCallback(async (): Promise<void> => {
    if (booking === null) return;
    const plan = ratePlanCodeSchema.safeParse(booking.ratePlanId);
    if (!plan.success) {
      setAlert(t('ops.reschedule.planUnresolved'));
      return;
    }
    setAlert(null);
    setBusy(true);
    setError(null);
    try {
      setQuote(
        (await api.quotes.quote(quoteRequestOf(booking, plan.data, checkIn, checkOut))).data,
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }, [api, booking, checkIn, checkOut]);

  const confirm = useCallback(async (): Promise<void> => {
    if (quote === null) return;
    setBusy(true);
    setError(null);
    try {
      const next = (
        await api.bookings.reschedule(
          bookingId,
          rescheduleRequestOf(checkIn, checkOut, quote.quoteId, reason),
        )
      ).data;
      setUpdated(next);
      setBooking(next);
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: '—',
          onReload: () => void load(),
          onLookup: () => void load(),
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [api, bookingId, checkIn, checkOut, load, quote, reason]);

  if (forced !== undefined) {
    return (
      <section data-testid="reschedule-screen" style={{ display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{t('ops.reschedule.title')}</h1>
        <StateSurface state={forced} />
      </section>
    );
  }

  return (
    <section
      data-testid="reschedule-screen"
      style={{ display: 'grid', gap: 12, padding: '16px 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('ops.reschedule.title')}</h1>
      {booking === null ? null : (
        <p data-testid="reschedule-current" style={{ margin: 0 }}>
          <code>{booking.code}</code> · {booking.status} · {formatBusinessDate(booking.checkIn)} →{' '}
          {formatBusinessDate(booking.checkOut)} · rescheduleCount {booking.rescheduleCount}
        </p>
      )}
      <StateSurface state={state}>
        {error === null ? null : <ScreenAlert error={error} onRetry={() => void load()} />}
        {alert === null ? null : (
          <p role="alert" data-testid="reschedule-alert" style={{ margin: 0 }}>
            {alert}
          </p>
        )}
        {updated !== null ? (
          <p role="status" data-testid="reschedule-result" style={{ margin: 0 }}>
            {t('ops.reschedule.result', {
              status: updated.status,
              count: updated.rescheduleCount,
              from: formatBusinessDate(updated.checkIn),
              to: formatBusinessDate(updated.checkOut),
            })}
          </p>
        ) : null}
        <div data-testid="reschedule-form" style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('ops.reschedule.checkIn')}
            <input
              name="checkIn"
              type="date"
              value={checkIn}
              disabled={busy}
              onChange={(event) => {
                setCheckIn(event.target.value);
              }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('ops.reschedule.checkOut')}
            <input
              name="checkOut"
              type="date"
              value={checkOut}
              disabled={busy}
              onChange={(event) => {
                setCheckOut(event.target.value);
              }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('ops.reschedule.reason')}
            <input
              name="reason"
              value={reason}
              disabled={busy}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="reschedule-check"
            disabled={busy}
            onClick={() => void checkPrice()}
          >
            {t('ops.reschedule.check')}
          </button>
          <button
            type="button"
            data-testid="reschedule-confirm"
            disabled={busy || quote === null}
            onClick={() => void confirm()}
          >
            {t('ops.reschedule.confirm')}
          </button>
        </div>
        {booking === null || quote === null ? null : <Difference booking={booking} quote={quote} />}
      </StateSurface>
    </section>
  );
}
