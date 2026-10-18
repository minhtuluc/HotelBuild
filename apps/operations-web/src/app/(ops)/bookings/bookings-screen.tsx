'use client';

/**
 * SCR-31 — danh sách & tra cứu booking (UC-BOOK-07, BR-BOOK-17, BR-RBAC-02).
 *
 * Lọc và phân trang **do máy chủ làm** (`GET /bookings`): màn hình chỉ đọc truy vấn URL, gửi đúng tham số
 * hợp đồng và nối trang theo con trỏ. Phạm vi cơ sở do máy chủ giới hạn theo phiên nhân viên; lối "xoá
 * cứng" chỉ hiện với DRAFT/HELD (BR-BOOK-17/14) và máy chủ vẫn chặn lần cuối.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBookingApi, isApiError } from '@pinehill/api-client';
import type { BookingSummary } from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { useOpsSession } from '../../../lib/ops-session';
import { t } from '../../../lib/i18n';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';
import { BookingsTable, DeletePanel, FilterForm } from './bookings-parts';
import {
  NO_FILTERS,
  appendBookings,
  filtersFrom,
  filtersToQuery,
  listQuery,
  nextCursorOf,
  type BookingFilters,
} from './bookings-model';

const PAGE_SIZE = 20;

export function BookingsScreen(): ReactElement {
  const forced = useForcedState();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = filtersFrom(searchParams);

  const session = useOpsSession(['/bookings'], {
    onExpired: () => setState({ kind: 'forbidden' }),
  });
  const api = useMemo(() => createBookingApi(session.client), [session]);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [bookings, setBookings] = useState<readonly BookingSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const [pendingDelete, setPendingDelete] = useState<BookingSummary | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [writeState, setWriteState] = useState<ScreenState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (after: string | null): Promise<void> => {
      setReadError(null);
      if (after === null) setState({ kind: 'loading' });
      try {
        const page = (await api.list(listQuery(filters, PAGE_SIZE, after))).data;
        setBookings((previous) => appendBookings(previous, page));
        setCursor(nextCursorOf(page));
        setState({ kind: 'ready' });
      } catch (caught) {
        const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
        if (mapped !== undefined) {
          setState(mapped);
          return;
        }
        if (after === null) setBookings([]);
        setReadError(caught);
        setState({ kind: 'ready' });
      }
    },
    [
      api,
      filters.channelCode,
      filters.from,
      filters.propertyId,
      filters.q,
      filters.status,
      filters.to,
    ],
  );

  useEffect(() => {
    if (forced !== undefined) return;
    void load(null);
  }, [forced, load]);

  if (forced !== undefined) {
    return (
      <section data-testid="bookings-screen" style={{ display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{t('ops.bookings.title')}</h1>
        <StateSurface state={forced} />
      </section>
    );
  }

  const applyFilters = (next: BookingFilters): void => {
    const query = filtersToQuery(next);
    router.push(query === '' ? '/bookings' : `/bookings?${query}`);
  };

  const confirmDelete = async (): Promise<void> => {
    if (pendingDelete === null) return;
    setBusy(true);
    setWriteState(null);
    try {
      await api.deleteBooking(pendingDelete.id, deleteReason.trim());
      setBookings((previous) => previous.filter((booking) => booking.id !== pendingDelete.id));
      setPendingDelete(null);
      setDeleteReason('');
    } catch (caught) {
      setWriteState(
        writeFailureState(caught, {
          attemptedVersion: String(pendingDelete.version ?? '—'),
          onReload: () => void load(null),
          onLookup: () => void load(null),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const empty = state.kind === 'ready' && bookings.length === 0;

  return (
    <section data-testid="bookings-screen" style={{ display: 'grid', gap: 12, padding: '16px 0' }}>
      <h1 style={{ margin: 0 }}>{t('ops.bookings.title')}</h1>
      <FilterForm current={filters} onApply={applyFilters} />
      {writeState === null ? null : <StateSurface state={writeState} />}
      <StateSurface
        state={
          empty
            ? {
                kind: 'empty',
                reason:
                  filtersToQuery(filters) === filtersToQuery(NO_FILTERS) ? 'noData' : 'filtered',
                canCreate: false,
              }
            : state
        }
      >
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(null)} />
        )}
        {bookings.length === 0 ? null : (
          <BookingsTable bookings={bookings} onDelete={setPendingDelete} />
        )}
        {cursor === null ? null : (
          <button
            type="button"
            data-testid="bookings-more"
            onClick={() => {
              void load(cursor);
            }}
          >
            {t('ops.bookings.more')}
          </button>
        )}
        {pendingDelete === null ? null : (
          <DeletePanel
            booking={pendingDelete}
            reason={deleteReason}
            busy={busy}
            onReason={setDeleteReason}
            onConfirm={() => void confirmDelete()}
            onCancel={() => {
              setPendingDelete(null);
              setDeleteReason('');
            }}
          />
        )}
      </StateSurface>
    </section>
  );
}
