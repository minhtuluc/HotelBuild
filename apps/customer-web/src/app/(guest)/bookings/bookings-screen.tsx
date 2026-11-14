'use client';

/**
 * SCR-09 — "Đơn của tôi" (UC-BOOK-07): danh sách booking **của chính khách** (máy chủ giới hạn theo phiên),
 * lọc theo trạng thái và tra cứu theo mã/SĐT (`q`), cuộn tiếp theo con trỏ máy chủ trả.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useGuestSession } from '../../../components/use-guest-session';
import { isApiError } from '@pinehill/api-client';
import { bookingStatusSchema } from '@pinehill/contracts';
import type { BookingSummary } from '@pinehill/contracts';
import {
  AccessDeniedPanel,
  StateSurface,
  formatMoney,
  formatStatusWithEnum,
  type ScreenState,
} from '@pinehill/ui-web';
import { useT, useTranslators } from '../../../i18n/client';
import { fetchMyBookings } from './api';
import {
  NO_FILTERS,
  STATUS_KEYS,
  appendPage,
  canPay,
  filtersFrom,
  filtersToQuery,
  nextCursorOf,
  stayText,
  type BookingFilters,
} from './model';
import { formatCountdown, holdView } from '../booking/booking-model';

type BookingStatusValue = BookingFilters['status'];

function FilterForm({
  current,
  onApply,
}: {
  current: BookingFilters;
  onApply: (filters: BookingFilters) => void;
}): ReactElement {
  const t = useT();
  const [status, setStatus] = useState<BookingStatusValue>(current.status);
  const [q, setQ] = useState(current.q);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onApply({ status, q: q.trim() });
  };

  return (
    <form
      data-testid="bookings-filters"
      onSubmit={submit}
      className="ph-card"
      style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}
    >
      <label className="ph-field" style={{ flex: '1 1 180px' }}>
        {t('guest.bookings.filter.status')}
        <select
          name="status"
          value={status}
          onChange={(event) => {
            const parsed = bookingStatusSchema.safeParse(event.target.value);
            setStatus(parsed.success ? parsed.data : '');
          }}
        >
          <option value="">{t('guest.bookings.filter.all')}</option>
          {Object.entries(STATUS_KEYS).map(([code, key]) => (
            <option key={code} value={code}>
              {t(key)}
            </option>
          ))}
        </select>
      </label>
      <label className="ph-field" style={{ flex: '1 1 200px' }}>
        {t('guest.bookings.filter.q')}
        <input
          name="q"
          type="search"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
          }}
        />
      </label>
      <button type="submit" className="ph-btn-primary">
        {t('guest.bookings.filter.submit')}
      </button>
      <button
        type="button"
        className="ph-btn"
        onClick={() => {
          setStatus('');
          setQ('');
          onApply(NO_FILTERS);
        }}
      >
        {t('guest.bookings.filter.clear')}
      </button>
    </form>
  );
}

function BookingRow({ booking }: { booking: BookingSummary }): ReactElement {
  const text = useTranslators();
  const t = useT();
  const hold = holdView(booking, Date.now());
  return (
    <tr data-testid={`booking-row-${booking.code}`}>
      <td className="ph-tabular" style={{ fontWeight: 500 }}>
        <Link
          href={`/bookings/${booking.id}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 44,
            color: 'var(--color-primary)',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          {booking.code}
        </Link>
      </td>
      <td>{formatStatusWithEnum(t(STATUS_KEYS[booking.status]), booking.status)}</td>
      <td className="ph-tabular">{stayText(text, booking)}</td>
      <td className="ph-tabular">{formatMoney(booking.totalAmount)}</td>
      <td className="ph-tabular" style={{ fontWeight: 500 }}>
        {formatMoney(booking.balanceDue)}
      </td>
      <td className="ph-tabular">
        {hold.kind === 'active' ? formatCountdown(hold.remainingMs) : t('guest.bookings.noHold')}
      </td>
      <td>
        {canPay(booking) ? (
          <Link href={`/booking/${booking.id}/pay`} className="ph-btn">
            {t('guest.booking.continue')}
          </Link>
        ) : (
          t('guest.bookings.noAction')
        )}
      </td>
    </tr>
  );
}

function BookingsTable({ bookings }: { bookings: readonly BookingSummary[] }): ReactElement {
  const t = useT();
  return (
    <div className="ph-table-wrap">
      <table data-testid="bookings-list">
        <caption
          style={{
            textAlign: 'start',
            padding: '14px 16px',
            fontFamily: 'var(--font-display)',
            fontSize: 18,
          }}
        >
          {t('guest.bookings.table')}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('guest.booking.code')}</th>
            <th scope="col">{t('guest.bookings.col.status')}</th>
            <th scope="col">{t('guest.bookings.col.stay')}</th>
            <th scope="col">{t('guest.bookings.col.total')}</th>
            <th scope="col">{t('guest.bookings.col.due')}</th>
            <th scope="col">{t('guest.bookings.col.hold')}</th>
            <th scope="col">{t('guest.bookings.col.action')}</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((booking) => (
            <BookingRow key={booking.id} booking={booking} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReadErrorBlock({ onRetry }: { onRetry: () => void }): ReactElement {
  const t = useT();
  return (
    <div role="alert" data-testid="bookings-alert" className="ph-alert-box">
      <p style={{ margin: 0 }}>{t('guest.bookings.error')}</p>
      <button type="button" data-testid="bookings-alert-retry" className="ph-btn" onClick={onRetry}>
        {t('guest.results.retry')}
      </button>
    </div>
  );
}

export function BookingsScreen(): ReactElement {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = filtersFrom(searchParams);

  const session = useGuestSession();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [bookings, setBookings] = useState<readonly BookingSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);

  const load = useCallback(
    async (after: string | null): Promise<void> => {
      setReadError(false);
      if (after === null) setState({ kind: 'loading' });
      try {
        const page = await fetchMyBookings(session, filters, after);
        setBookings((previous) => appendPage(previous, page));
        setCursor(nextCursorOf(page));
        setState({ kind: 'ready' });
      } catch (caught) {
        if (isApiError(caught) && caught.status === 403) {
          setState({ kind: 'forbidden' });
          return;
        }
        if (after === null) setBookings([]);
        setReadError(true);
        setState({ kind: 'ready' });
      }
    },
    [filters.status, filters.q, session],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  if (state.kind === 'forbidden')
    return (
      <div className="ph-page-shell">
        <AccessDeniedPanel backHref="/" />
      </div>
    );

  const applyFilters = (next: BookingFilters): void => {
    const query = filtersToQuery(next);
    router.push(query === '' ? '/bookings' : `/bookings?${query}`);
  };

  const empty = bookings.length === 0;

  return (
    <section data-testid="bookings-screen" className="ph-page-shell">
      <div className="ph-page-header">
        <h1 className="ph-page-title">{t('guest.bookings.title')}</h1>
      </div>
      <FilterForm current={filters} onApply={applyFilters} />
      <StateSurface
        state={
          empty && state.kind === 'ready'
            ? {
                kind: 'empty',
                reason: filters.status === '' && filters.q === '' ? 'noData' : 'filtered',
                canCreate: false,
              }
            : state
        }
      >
        {readError ? <ReadErrorBlock onRetry={() => void load(null)} /> : null}
        {empty ? null : <BookingsTable bookings={bookings} />}
        {cursor === null ? null : (
          <div>
            <button
              type="button"
              data-testid="bookings-more"
              className="ph-btn"
              onClick={() => {
                void load(cursor);
              }}
            >
              {t('guest.bookings.more')}
            </button>
          </div>
        )}
      </StateSurface>
    </section>
  );
}
