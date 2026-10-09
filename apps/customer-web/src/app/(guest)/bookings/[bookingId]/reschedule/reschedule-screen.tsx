'use client';

/**
 * SCR-12 — đổi ngày lưu trú (UC-BOOK-06, BR-BOOK-12/13; thiết kế §8.1).
 *
 * Trình tự: nhập kỳ mới → **xem chênh lệch** (giá kỳ mới lấy bằng `POST /quotes`, giá đang giữ lấy từ
 * `GET /bookings/{id}`) → mới mở nút xác nhận → `POST /bookings/{id}/reschedule`.
 *
 * Ghi chú hợp đồng: phản hồi đổi ngày là `bookingSummarySchema` — không có trường chênh lệch/phí, và màn
 * hình **không** tự tính tiền phải trả (ADR-018); chênh lệch ở đây chỉ là hiệu của hai con số máy chủ trả.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createSessionClient } from '@pinehill/web-session/client';
import { isApiError } from '@pinehill/api-client';
import { ratePlanCodeSchema } from '@pinehill/contracts';
import type { BookingSummary, Quote } from '@pinehill/contracts';
import {
  AccessDeniedPanel,
  StateSurface,
  actionMessageKey,
  formatStatusWithEnum,
  formatStayPeriod,
  mapErrorToUiAction,
  type ScreenState,
} from '@pinehill/ui-web';
import { t } from '../../../../../lib/i18n';
import { fetchBooking } from '../../../booking/booking-api';
import { fetchQuoteWithSession } from '../../../book/booking-api';
import { rescheduleBooking } from '../../api';
import { STATUS_KEYS } from '../../model';
import { STAY_ISSUE_KEYS, isSameStay, stayIssue } from '../../reschedule-model';
import { RescheduleForm, RescheduleOutcome } from './reschedule-parts';

export function RescheduleScreen(): ReactElement {
  const routeParams = useParams<{ bookingId: string }>();
  const bookingId = typeof routeParams.bookingId === 'string' ? routeParams.bookingId : '';

  const session = useMemo(() => createSessionClient({ kind: 'guest' }), []);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [baseline, setBaseline] = useState<BookingSummary | null>(null);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BookingSummary | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => () => session.dispose(), [session]);

  const failure = useCallback((caught: unknown): void => {
    const code = isApiError(caught) ? caught.code : undefined;
    const status = isApiError(caught) ? caught.status : undefined;
    const action = mapErrorToUiAction({ code, status });
    if (action === 'not-found') {
      setNotFound(true);
      return;
    }
    if (action === 'reauth' || code === 'E_RBAC_FORBIDDEN' || code === 'E_AUTH_OUT_OF_SCOPE') {
      setForbidden(true);
      return;
    }
    // Kỳ/tồn đã đổi: huỷ bản chênh lệch đang hiện, buộc lấy giá lại trước khi xác nhận.
    if (action === 'reload-and-diff' || action === 'reload-and-reselect') setQuote(null);
    setAlert(t(actionMessageKey(action)));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const loaded = await fetchBooking(session, bookingId);
      setBooking(loaded);
      setBaseline(loaded);
      setCheckIn(loaded.checkIn);
      setCheckOut(loaded.checkOut);
      setState({ kind: 'ready' });
    } catch (caught) {
      setState({ kind: 'ready' });
      failure(caught);
    }
  }, [bookingId, session, failure]);

  useEffect(() => {
    void load();
  }, [load]);

  const issue = stayIssue(checkIn, checkOut);
  const same = baseline !== null && isSameStay(baseline, { checkIn, checkOut });

  const checkPrice = useCallback(async (): Promise<void> => {
    if (booking === null || issue !== null || same) return;
    setAlert(null);
    setQuote(null);
    // Gói đang giữ chỉ có `ratePlanId`; báo giá cần `ratePlanCode` nên chỉ nhận khi giá trị đó **đúng**
    // là một mã gói công bố (kiểm bằng schema, không đoán).
    const planCode = ratePlanCodeSchema.safeParse(booking.ratePlanId);
    if (!planCode.success) {
      setAlert(t('guest.reschedule.planUnresolved'));
      return;
    }
    setBusy(true);
    try {
      // Giá kỳ mới là báo giá công khai của chính kênh/gói đang giữ; máy chủ vẫn là nơi chốt giá.
      setQuote(
        await fetchQuoteWithSession(session, {
          propertyId: booking.propertyId,
          roomTypeId: booking.roomTypeId,
          channelCode: 'WEB',
          ratePlanCode: planCode.data,
          checkIn,
          checkOut,
          adults: booking.adults,
          children: booking.children,
          roomCount: booking.roomCount,
        }),
      );
    } catch (caught) {
      failure(caught);
    } finally {
      setBusy(false);
    }
  }, [booking, checkIn, checkOut, issue, same, session, failure]);

  const confirm = useCallback(async (): Promise<void> => {
    if (booking === null || quote === null) return;
    setAlert(null);
    setBusy(true);
    try {
      const trimmed = note.trim();
      const updated = await rescheduleBooking(session, bookingId, {
        checkIn,
        checkOut,
        ...(trimmed === '' ? {} : { reason: trimmed }),
        quoteId: quote.quoteId,
      });
      setResult(updated);
      setBooking(updated);
    } catch (caught) {
      failure(caught);
    } finally {
      setBusy(false);
    }
  }, [booking, bookingId, checkIn, checkOut, note, quote, session, failure]);

  if (forbidden) return <AccessDeniedPanel backHref={`/bookings/${bookingId}`} />;
  if (notFound) {
    return (
      <section
        role="alert"
        data-testid="reschedule-not-found"
        style={{
          display: 'grid',
          gap: 'var(--space-s3, 12px)',
          padding: 'var(--space-s4, 16px) 0',
        }}
      >
        <h1 style={{ margin: 0 }}>{t('guest.reschedule.title')}</h1>
        <p style={{ margin: 0 }}>{t('guest.booking.notFound')}</p>
        <Link href="/bookings">{t('guest.bookings.back')}</Link>
      </section>
    );
  }

  return (
    <section
      data-testid="reschedule-screen"
      style={{ display: 'grid', gap: 'var(--space-s3, 12px)', padding: 'var(--space-s4, 16px) 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('guest.reschedule.title')}</h1>
      <StateSurface state={state}>
        {baseline === null ? null : (
          <p data-testid="reschedule-current" style={{ margin: 0 }}>
            {t(result === null ? 'guest.reschedule.current' : 'guest.reschedule.currentBefore')}{' '}
            <code>{baseline.code}</code> ·{' '}
            {formatStatusWithEnum(t(STATUS_KEYS[baseline.status]), baseline.status)} ·{' '}
            {baseline.checkIn} → {baseline.checkOut} ·{' '}
            {formatStayPeriod(baseline.nights, baseline.adults, baseline.children)}
          </p>
        )}

        {result === null ? (
          <RescheduleForm
            checkIn={checkIn}
            checkOut={checkOut}
            note={note}
            busy={busy}
            issueKey={issue === null ? null : STAY_ISSUE_KEYS[issue]}
            same={same}
            confirmEnabled={quote !== null}
            onCheckIn={setCheckIn}
            onCheckOut={setCheckOut}
            onNote={setNote}
            onCheck={() => {
              void checkPrice();
            }}
            onConfirm={() => {
              void confirm();
            }}
          />
        ) : null}

        {alert === null ? null : (
          <p role="alert" data-testid="reschedule-alert" style={{ margin: 0 }}>
            {alert}
          </p>
        )}
        <RescheduleOutcome
          baseline={baseline}
          booking={booking}
          quote={quote}
          result={result}
          checkIn={checkIn}
          checkOut={checkOut}
        />
      </StateSurface>
    </section>
  );
}
