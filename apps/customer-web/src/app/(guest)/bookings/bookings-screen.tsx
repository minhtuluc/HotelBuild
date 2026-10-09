'use client';

/**
 * SCR-09 — "Đơn của tôi" (UC-BOOK-07): danh sách booking **của chính khách** (máy chủ giới hạn theo phiên),
 * lọc theo trạng thái và tra cứu theo mã/SĐT (`q`), cuộn tiếp theo con trỏ máy chủ trả.
 *
 * Ghi chú hợp đồng: `GET /bookings` chỉ trả `bookingSummarySchema` (không có PriceSnapshot từng đêm hay
 * danh sách Payment) — màn hình không bịa các số liệu đó; phần thiếu đã ghi ở PR HB-102.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createSessionClient } from '@pinehill/web-session/client';
import { isApiError } from '@pinehill/api-client';
import { bookingStatusSchema } from '@pinehill/contracts';
import type { BookingSummary } from '@pinehill/contracts';
import {
  AccessDeniedPanel,
  StateSurface,
  formatMoney,
  formatStatusWithEnum,
  formatStayPeriod,
  type ScreenState,
} from '@pinehill/ui-web';
import { t } from '../../../lib/i18n';
import { fetchMyBookings } from './api';
import {
  NO_FILTERS,
  STATUS_KEYS,
  appendPage,
  canPay,
  filtersFrom,
  filtersToQuery,
  nextCursorOf,
  type BookingFilters,
} from './model';
import { formatCountdown, holdView } from '../booking/booking-model';

const FIELD_STYLE = { display: 'grid', gap: 4 } as const;
const CELL = { padding: '4px 12px 4px 0', textAlign: 'left' } as const;

function FilterForm({
  current,
  onApply,
}: {
  current: BookingFilters;
  onApply: (filters: BookingFilters) => void;
}): ReactElement {
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
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}
    >
      <label style={FIELD_STYLE}>
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
      <label style={FIELD_STYLE}>
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
      <button type="submit">{t('guest.bookings.filter.submit')}</button>
      <button
        type="button"
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
  const hold = holdView(booking, Date.now());
  return (
    <tr data-testid={`booking-row-${booking.code}`}>
      <td style={CELL}>
        <Link href={`/bookings/${booking.id}`}>{booking.code}</Link>
      </td>
      <td style={CELL}>{formatStatusWithEnum(t(STATUS_KEYS[booking.status]), booking.status)}</td>
      <td style={CELL}>
        {booking.checkIn} → {booking.checkOut} ·{' '}
        {formatStayPeriod(booking.nights, booking.adults, booking.children)}
      </td>
      <td style={CELL}>{formatMoney(booking.totalAmount)}</td>
      <td style={CELL}>{formatMoney(booking.balanceDue)}</td>
      <td style={CELL}>
        {hold.kind === 'active' ? formatCountdown(hold.remainingMs) : t('guest.bookings.noHold')}
      </td>
      <td style={CELL}>
        {canPay(booking) ? (
          <Link href={`/booking/${booking.id}/pay`}>{t('guest.booking.continue')}</Link>
        ) : (
          t('guest.bookings.noAction')
        )}
      </td>
    </tr>
  );
}

function BookingsTable({ bookings }: { bookings: readonly BookingSummary[] }): ReactElement {
  return (
    <table data-testid="bookings-list">
      <caption style={{ textAlign: 'left', paddingBottom: 4 }}>{t('guest.bookings.table')}</caption>
      <thead>
        <tr>
          <th scope="col" style={CELL}>
            {t('guest.booking.code')}
          </th>
          <th scope="col" style={CELL}>
            {t('guest.bookings.col.status')}
          </th>
          <th scope="col" style={CELL}>
            {t('guest.bookings.col.stay')}
          </th>
          <th scope="col" style={CELL}>
            {t('guest.bookings.col.total')}
          </th>
          <th scope="col" style={CELL}>
            {t('guest.bookings.col.due')}
          </th>
          <th scope="col" style={CELL}>
            {t('guest.bookings.col.hold')}
          </th>
          <th scope="col" style={CELL}>
            {t('guest.bookings.col.action')}
          </th>
        </tr>
      </thead>
      <tbody>
        {bookings.map((booking) => (
          <BookingRow key={booking.id} booking={booking} />
        ))}
      </tbody>
    </table>
  );
}

function ReadErrorBlock({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <div role="alert" data-testid="bookings-alert" style={{ display: 'grid', gap: 8 }}>
      <p style={{ margin: 0 }}>{t('guest.bookings.error')}</p>
      <button type="button" data-testid="bookings-alert-retry" onClick={onRetry}>
        {t('guest.results.retry')}
      </button>
    </div>
  );
}

export function BookingsScreen(): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = filtersFrom(searchParams);

  const session = useMemo(() => createSessionClient({ kind: 'guest' }), []);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [bookings, setBookings] = useState<readonly BookingSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);

  useEffect(() => () => session.dispose(), [session]);

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

  // Đổi bộ lọc (hoặc mở lại trang) thì nạp lại từ trang đầu.
  useEffect(() => {
    void load(null);
  }, [load]);

  if (state.kind === 'forbidden') return <AccessDeniedPanel backHref="/" />;

  const applyFilters = (next: BookingFilters): void => {
    const query = filtersToQuery(next);
    router.push(query === '' ? '/bookings' : `/bookings?${query}`);
  };

  const empty = bookings.length === 0;

  return (
    <section
      data-testid="bookings-screen"
      style={{ display: 'grid', gap: 'var(--space-s3, 12px)', padding: 'var(--space-s4, 16px) 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('guest.bookings.title')}</h1>
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
          <button
            type="button"
            data-testid="bookings-more"
            onClick={() => {
              void load(cursor);
            }}
          >
            {t('guest.bookings.more')}
          </button>
        )}
      </StateSurface>
    </section>
  );
}

/** Trạng thái lọc: `''` = tất cả. */
type BookingStatusValue = BookingFilters['status'];
