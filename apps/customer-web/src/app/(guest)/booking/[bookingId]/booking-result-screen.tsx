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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSessionClient } from '@pinehill/web-session/client';
import { isApiError } from '@pinehill/api-client';
import type { BookingStatus, BookingSummary } from '@pinehill/contracts';
import {
  AccessDeniedPanel,
  StateSurface,
  formatDateTimeVn,
  formatMoney,
  formatStatusWithEnum,
  formatStayPeriod,
  type ScreenState,
} from '@pinehill/ui-web';
import { formatStaySpan } from '../../bookings/stay-format';
import { t, type CustomerMessageKey } from '../../../../lib/i18n';
import { fetchBooking } from '../booking-api';
import {
  continueAction,
  continueHref,
  formatCountdown,
  holdView,
  moneyRows,
  type HoldView,
  type MoneyRow,
} from '../booking-model';

/** Nhịp đếm hiển thị — chỉ là nhịp vẽ lại, hạn thật vẫn do máy chủ trả. */
const TICK_MS = 1000;
const CELL = { padding: '4px 12px 4px 0', textAlign: 'left' } as const;
const CAPTION = { textAlign: 'left', paddingBottom: 4 } as const;

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

const MONEY_KEYS: Readonly<Record<MoneyRow['key'], CustomerMessageKey>> = {
  total: 'guest.booking.money.total',
  deposit: 'guest.booking.money.deposit',
  paid: 'guest.booking.money.paid',
  penalty: 'guest.booking.money.penalty',
  balance: 'guest.booking.money.balance',
};

function HoldLine({ hold }: { hold: HoldView }): ReactElement {
  if (hold.kind === 'active') {
    const expires = hold.expiresAt === null ? '' : formatDateTimeVn(hold.expiresAt);
    return (
      <p data-testid="booking-hold" style={{ margin: 0, display: 'grid', gap: 4 }}>
        <span>
          {t('guest.booking.hold.counting')}{' '}
          <strong data-testid="booking-countdown" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatCountdown(hold.remainingMs)}
          </strong>
        </span>
        <span data-testid="booking-hold-expires">
          {t('guest.booking.hold.expiresAt', { time: expires })}
        </span>
      </p>
    );
  }
  const text =
    hold.kind === 'expired'
      ? t('guest.booking.hold.expired', {
          time: hold.expiresAt === null ? '' : formatDateTimeVn(hold.expiresAt),
        })
      : t('guest.booking.hold.none');
  return (
    <p role="status" data-testid="booking-hold" style={{ margin: 0 }}>
      {text}
    </p>
  );
}

/** Kỳ ở hiển thị ở màn kết quả (SCR-07): ngày lịch dd/MM/yyyy qua helper dùng chung. */
export function StayTable({ booking }: { booking: BookingSummary }): ReactElement {
  return (
    <table data-testid="booking-stay">
      <caption style={CAPTION}>{t('guest.booking.stay')}</caption>
      <tbody>
        <tr>
          <th scope="row" style={CELL}>
            {t('guest.booking.stay.period')}
          </th>
          <td style={CELL}>
            {formatStaySpan(
              booking.checkIn,
              booking.checkOut,
              formatStayPeriod(booking.nights, booking.adults, booking.children),
            )}
          </td>
        </tr>
        <tr>
          <th scope="row" style={CELL}>
            {t('guest.booking.stay.rooms')}
          </th>
          <td style={CELL}>{booking.roomCount}</td>
        </tr>
      </tbody>
    </table>
  );
}

function MoneyTable({ booking }: { booking: BookingSummary }): ReactElement {
  return (
    <table data-testid="booking-money">
      <caption style={CAPTION}>{t('guest.booking.money')}</caption>
      <tbody>
        {moneyRows(booking).map((row) => (
          <tr key={row.key}>
            <th scope="row" style={CELL}>
              {row.key === 'deposit'
                ? t(MONEY_KEYS[row.key], { percent: booking.depositPercent })
                : t(MONEY_KEYS[row.key])}
            </th>
            <td style={CELL}>{formatMoney(row.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FlagsList({ booking }: { booking: BookingSummary }): ReactElement | null {
  const flags = [
    booking.oversold ? t('guest.booking.flag.oversold') : null,
    booking.duplicateSuspected ? t('guest.booking.flag.duplicate') : null,
    booking.priceLocked ? t('guest.booking.flag.priceLocked') : null,
  ].filter((flag): flag is string => flag !== null);
  if (flags.length === 0) return null;
  return (
    <ul data-testid="booking-flags" style={{ margin: 0 }}>
      {flags.map((flag) => (
        <li key={flag}>{flag}</li>
      ))}
    </ul>
  );
}

/**
 * Khối xác nhận của màn kết quả (SCR-07): kỳ ở hiển thị ngày lịch dd/MM/yyyy qua helper dùng
 * chung; các mốc thời điểm (giữ chỗ, tạo đơn) vẫn là timestamp có nhãn giờ VN.
 */
export function ConfirmationBlock({ booking }: { booking: BookingSummary }): ReactElement {
  return (
    <section
      data-testid="booking-confirmation"
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}
    >
      <h2 style={{ margin: 0 }}>{t('guest.booking.confirmation')}</h2>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 4 }}>
        <dt>{t('guest.booking.code')}</dt>
        <dd style={{ margin: 0 }}>
          <code>{booking.code}</code>
        </dd>
        <dt>{t('guest.booking.stay')}</dt>
        <dd style={{ margin: 0 }}>
          {formatStaySpan(
            booking.checkIn,
            booking.checkOut,
            formatStayPeriod(booking.nights, booking.adults, booking.children),
          )}
        </dd>
        <dt>{t('guest.booking.money.total')}</dt>
        <dd style={{ margin: 0 }}>{formatMoney(booking.totalAmount)}</dd>
        <dt>{t('guest.booking.money.balance')}</dt>
        <dd style={{ margin: 0 }}>{formatMoney(booking.balanceDue)}</dd>
        <dt>{t('guest.booking.created')}</dt>
        <dd style={{ margin: 0 }}>{formatDateTimeVn(booking.createdAt)}</dd>
      </dl>
    </section>
  );
}

function ContinueButton({
  booking,
  hold,
  bookingId,
}: {
  booking: BookingSummary;
  hold: HoldView;
  bookingId: string;
}): ReactElement | null {
  const router = useRouter();
  const action = continueAction(booking, hold);
  if (action.kind === 'none') return null;
  return (
    <button
      type="button"
      data-testid="booking-continue"
      disabled={action.kind === 'locked'}
      onClick={() => {
        router.push(continueHref(bookingId));
      }}
    >
      {t('guest.booking.continue')}
    </button>
  );
}

function CodeLine({ code }: { code: string }): ReactElement {
  const [note, setNote] = useState<'ok' | 'failed' | null>(null);
  return (
    <>
      <p data-testid="booking-code" style={{ margin: 0 }}>
        <code style={{ fontSize: 'var(--text-h2, 20px)' }}>{code}</code>{' '}
        <button
          type="button"
          data-testid="booking-copy"
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
      </p>
      <p role="status" aria-live="polite" data-testid="booking-copy-note" style={{ margin: 0 }}>
        {note === null
          ? ''
          : t(note === 'ok' ? 'guest.booking.copy.ok' : 'guest.booking.copy.failed')}
      </p>
    </>
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
  const locked = continueAction(booking, hold).kind === 'locked';
  return (
    <>
      <p data-testid="booking-status" style={{ margin: 0 }}>
        {formatStatusWithEnum(t(STATUS_KEYS[booking.status]), booking.status)}
      </p>
      <CodeLine code={booking.code} />
      <HoldLine hold={hold} />
      <StayTable booking={booking} />
      <MoneyTable booking={booking} />
      <FlagsList booking={booking} />
      <ConfirmationBlock booking={booking} />
      <div data-testid="booking-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" data-testid="booking-reload" onClick={onReload}>
          {t('guest.booking.reload')}
        </button>
        <button type="button" data-testid="booking-print" onClick={() => window.print()}>
          {t('guest.booking.print')}
        </button>
        <ContinueButton booking={booking} hold={hold} bookingId={bookingId} />
      </div>
      {locked ? (
        <p role="status" data-testid="booking-locked" style={{ margin: 0 }}>
          {t('guest.booking.continueLocked')}
        </p>
      ) : null}
    </>
  );
}

function ReadErrorBlock({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <div
      role="alert"
      data-testid="booking-alert"
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}
    >
      <p style={{ margin: 0 }}>{t('guest.booking.error')}</p>
      <button type="button" data-testid="booking-alert-retry" onClick={onRetry}>
        {t('guest.results.retry')}
      </button>
    </div>
  );
}

function NotFoundBlock(): ReactElement {
  return (
    <section
      role="alert"
      data-testid="booking-not-found"
      style={{ display: 'grid', gap: 'var(--space-s3, 12px)', padding: 'var(--space-s4, 16px) 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('guest.booking.title')}</h1>
      <p style={{ margin: 0 }}>{t('guest.booking.notFound')}</p>
      <p style={{ margin: 0 }}>{t('guest.booking.notFoundHint')}</p>
      <Link href="/">{t('guest.results.backHome')}</Link>
    </section>
  );
}

export function BookingResultScreen(): ReactElement {
  const routeParams = useParams<{ bookingId: string }>();
  const bookingId = typeof routeParams.bookingId === 'string' ? routeParams.bookingId : '';

  // Phiên khách: tuyến `GET /bookings/{id}` cần access token do session client cấp qua BFF.
  const session = useMemo(() => createSessionClient({ kind: 'guest' }), []);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [readError, setReadError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const recheckDone = useRef(false);

  useEffect(() => () => session.dispose(), [session]);

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

  const reload = useCallback((): void => {
    void load();
  }, [load]);

  const hold = booking === null ? null : holdView(booking, nowMs);
  const holdKind = hold === null ? 'none' : hold.kind;

  // Đếm hiển thị: chỉ chạy khi đang giữ chỗ; về 0 thì dừng và để bước đối chiếu máy chủ quyết định.
  useEffect(() => {
    if (holdKind !== 'active') return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [holdKind]);

  // AC1 + AC2: vừa hết hạn thì **hỏi lại máy chủ** — máy chủ là nguồn quyết định (có thể đã gia hạn).
  useEffect(() => {
    if (holdKind !== 'expired') {
      recheckDone.current = false;
      return;
    }
    if (recheckDone.current) return;
    recheckDone.current = true;
    void load();
  }, [holdKind, load]);

  if (state.kind === 'forbidden') return <AccessDeniedPanel backHref="/" />;
  if (notFound) return <NotFoundBlock />;

  return (
    <section
      data-testid="booking-result"
      style={{ display: 'grid', gap: 'var(--space-s3, 12px)', padding: 'var(--space-s4, 16px) 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('guest.booking.title')}</h1>
      <StateSurface state={state}>
        {readError ? <ReadErrorBlock onRetry={reload} /> : null}
        {booking === null || hold === null ? null : (
          <BookingDetails booking={booking} hold={hold} bookingId={bookingId} onReload={reload} />
        )}
      </StateSurface>
    </section>
  );
}
