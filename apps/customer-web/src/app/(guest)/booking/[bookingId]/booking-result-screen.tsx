'use client';

/**
 * SCR-07 — kết quả đặt phòng & đếm ngược giữ chỗ (UC-BOOK-04, TC-BOOK-28; thiết kế màn hình §8.1).
 *
 * Nguyên tắc:
 * - **AC2**: trạng thái chỉ đến từ `GET /bookings/{id}` — màn hình không suy "thành công" từ URL/truy vấn
 *   hay từ chuyển hướng; mở lại trang nào cũng đọc máy chủ.
 * - **AC1**: đồng hồ đếm theo mốc `holdExpiresAt` của máy chủ; đếm về 0 thì **đọc lại** máy chủ và khoá nút
 *   tiếp tục khi vẫn quá hạn giữ chỗ.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { useGuestSession } from '../../../../components/use-guest-session';
import { isApiError } from '@pinehill/api-client';
import type { BookingStatus, BookingSummary } from '@pinehill/contracts';
import {
  AccessDeniedPanel,
  StateSurface,
  formatStatusWithEnum,
  type ScreenState,
} from '@pinehill/ui-web';
import { useT } from '../../../../i18n/client';
import type { CustomerMessageKey } from '../../../../i18n/catalogs';
import { fetchBooking } from '../booking-api';
import { continueAction, continueHref, holdView, type HoldView } from '../booking-model';
import {
  ConfirmationBlock,
  FlagsList,
  HoldLine,
  MoneyTable,
  StayTable,
} from './booking-result-parts';
import { useLocalePath } from '../../../../i18n/client';

export { ConfirmationBlock, StayTable };

const TICK_MS = 1000;

const STATUS_KEYS: Readonly<Record<BookingStatus, CustomerMessageKey>> = {
  DRAFT: 'guest.booking.status.DRAFT',
  HELD: 'guest.booking.status.HELD',
  PENDING_PAYMENT: 'guest.booking.status.PENDING_PAYMENT',
  CONFIRMED: 'guest.booking.status.CONFIRMED',
  CHECKED_IN: 'guest.booking.status.CHECKED_IN',
  CHECKED_OUT: 'guest.booking.status.CHECKED_OUT',
  CANCELLED: 'guest.booking.status.CANCELLED',
  NO_SHOW: 'guest.booking.status.NO_SHOW',
  EXPIRED: 'guest.booking.status.EXPIRED',
};

function ContinueButton({
  booking,
  hold,
  bookingId,
}: {
  booking: BookingSummary;
  hold: HoldView;
  bookingId: string;
}): ReactElement | null {
  const localPath = useLocalePath();
  const t = useT();
  const router = useRouter();
  const action = continueAction(booking, hold);
  if (action.kind === 'none') return null;
  return (
    <button
      type="button"
      data-testid="booking-continue"
      className="ph-btn-accent ph-btn-lg"
      disabled={action.kind === 'locked'}
      onClick={() => {
        router.push(localPath(continueHref(bookingId)));
      }}
    >
      {t('guest.booking.continue')}
    </button>
  );
}

function CodeLine({ code }: { code: string }): ReactElement {
  const t = useT();
  const [note, setNote] = useState<'ok' | 'failed' | null>(null);
  return (
    <div className="ph-card" style={{ display: 'grid', gap: 8 }}>
      <div
        data-testid="booking-code"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <code
          className="ph-tabular"
          style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.35rem, 2.5vw, 1.8rem)' }}
        >
          {code}
        </code>
        <button
          type="button"
          data-testid="booking-copy"
          className="ph-btn"
          onClick={() => {
            void navigator.clipboard
              .writeText(code)
              .then(() => {
                setNote('ok');
              })
              .catch(() => {
                setNote('failed');
              });
          }}
        >
          {t('guest.booking.copy')}
        </button>
      </div>
      <p
        role="status"
        aria-live="polite"
        data-testid="booking-copy-note"
        style={{ margin: 0, fontSize: 13 }}
      >
        {note === null
          ? ''
          : t(note === 'ok' ? 'guest.booking.copy.ok' : 'guest.booking.copy.failed')}
      </p>
    </div>
  );
}

function BookingDetails({
  booking,
  hold,
  bookingId,
  onReload,
}: {
  booking: BookingSummary;
  hold: HoldView;
  bookingId: string;
  onReload: () => void;
}): ReactElement {
  const t = useT();
  const locked = continueAction(booking, hold).kind === 'locked';
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <p data-testid="booking-status" style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>
        {formatStatusWithEnum(t(STATUS_KEYS[booking.status]), booking.status)}
      </p>
      <CodeLine code={booking.code} />
      <HoldLine hold={hold} />
      <div className="ph-two-col">
        <StayTable booking={booking} />
        <MoneyTable booking={booking} />
      </div>
      <FlagsList booking={booking} />
      <ConfirmationBlock booking={booking} />
      <div data-testid="booking-actions" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" data-testid="booking-reload" className="ph-btn" onClick={onReload}>
          {t('guest.booking.reload')}
        </button>
        <button
          type="button"
          data-testid="booking-print"
          className="ph-btn"
          onClick={() => window.print()}
        >
          {t('guest.booking.print')}
        </button>
        <ContinueButton booking={booking} hold={hold} bookingId={bookingId} />
      </div>
      {locked ? (
        <p
          role="status"
          data-testid="booking-locked"
          className="ph-alert-box"
          style={{ margin: 0 }}
        >
          {t('guest.booking.continueLocked')}
        </p>
      ) : null}
    </div>
  );
}

function NotFoundBlock(): ReactElement {
  const localPath = useLocalePath();
  const t = useT();
  return (
    <section role="alert" data-testid="booking-not-found" className="ph-page-shell">
      <div className="ph-page-header">
        <h1 className="ph-page-title">{t('guest.booking.title')}</h1>
      </div>
      <div className="ph-alert-box">
        <p style={{ margin: 0 }}>{t('guest.booking.notFound')}</p>
        <p style={{ margin: 0 }}>{t('guest.booking.notFoundHint')}</p>
        <Link href={localPath('/')} className="ph-btn">
          {t('guest.results.backHome')}
        </Link>
      </div>
    </section>
  );
}

export function BookingResultScreen(): ReactElement {
  const t = useT();
  const routeParams = useParams<{ bookingId: string }>();
  const bookingId = typeof routeParams.bookingId === 'string' ? routeParams.bookingId : '';
  const session = useGuestSession();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [readError, setReadError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const recheckDone = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    setReadError(false);
    setNotFound(false);
    setState({ kind: 'loading' });
    try {
      const loaded = await fetchBooking(session, bookingId);
      setBooking(loaded);
      setNowMs(Date.now());
      setState({ kind: 'ready' });
    } catch (caught) {
      const status = isApiError(caught) ? caught.status : undefined;
      setBooking(null);
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

  const reload = useCallback((): void => {
    void load();
  }, [load]);

  const hold = booking === null ? null : holdView(booking, nowMs);
  const holdKind = hold === null ? 'none' : hold.kind;

  useEffect(() => {
    if (holdKind !== 'active') return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [holdKind]);

  useEffect(() => {
    if (holdKind !== 'expired') {
      recheckDone.current = false;
      return;
    }
    if (recheckDone.current) return;
    recheckDone.current = true;
    void load();
  }, [holdKind, load]);

  if (state.kind === 'forbidden')
    return (
      <div className="ph-page-shell">
        <AccessDeniedPanel backHref="/" />
      </div>
    );
  if (notFound) return <NotFoundBlock />;

  return (
    <section data-testid="booking-result" className="ph-page-shell">
      <div className="ph-page-header">
        <h1 className="ph-page-title">{t('guest.booking.title')}</h1>
      </div>
      <StateSurface state={state}>
        {readError ? (
          <div role="alert" data-testid="booking-alert" className="ph-alert-box">
            <p style={{ margin: 0 }}>{t('guest.booking.error')}</p>
            <button
              type="button"
              data-testid="booking-alert-retry"
              className="ph-btn"
              onClick={reload}
            >
              {t('guest.results.retry')}
            </button>
          </div>
        ) : null}
        {booking === null || hold === null ? null : (
          <BookingDetails booking={booking} hold={hold} bookingId={bookingId} onReload={reload} />
        )}
      </StateSurface>
    </section>
  );
}
