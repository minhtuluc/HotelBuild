'use client';

/**
 * SCR-11 — huỷ đặt phòng & số tiền hoàn theo bậc (UC-BOOK-08, TC-SYS-10).
 *
 * Trình tự bắt buộc (HB-103 AC1):
 * 1. **Luôn** xem trước số tiền hoàn (`POST .../cancel-preview`) trước khi có nút xác nhận.
 * 2. Đang tính thì khoá cả nút xem trước lẫn nút xác nhận.
 * 3. Ngay trước khi huỷ, màn hình **đối chiếu lại** với máy chủ: số liệu đổi (qua mốc/version) thì không
 *    huỷ, mà hiện lại số mới và buộc khách xác nhận lần nữa.
 *
 * Giao diện không tính tiền, không suy luật chính sách (ADR-018): mọi con số là nguyên văn máy chủ trả.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createSessionClient } from '@pinehill/web-session/client';
import { isApiError } from '@pinehill/api-client';
import type { BookingSummary, CancelPreview, CancelResponse } from '@pinehill/contracts';
import {
  AccessDeniedPanel,
  StateSurface,
  actionMessageKey,
  formatDateTimeVn,
  formatMoney,
  formatStatusWithEnum,
  formatStayPeriod,
  mapErrorToUiAction,
  type ScreenState,
} from '@pinehill/ui-web';
import { t, type CustomerMessageKey } from '../../../../../lib/i18n';
import { fetchBooking } from '../../../booking/booking-api';
import { fetchCancelPreview, cancelBooking } from '../../api';
import { STATUS_KEYS } from '../../model';
import {
  CANCEL_REASONS,
  CANCEL_REASON_KEYS,
  canConfirm,
  claimsForceMajeure,
  formatHoursBeforeCheckIn,
  refundRows,
  samePreview,
  type CancelReason,
  type CancelStep,
  type CancellationBreakdown,
} from '../../cancel-model';

const CELL = { padding: '4px 12px 4px 0', textAlign: 'left' } as const;

const REFUND_KEYS: Readonly<Record<'paid' | 'requested' | 'penalty' | 'fee', CustomerMessageKey>> =
  {
    paid: 'guest.cancel.refund.paid',
    requested: 'guest.cancel.refund.requested',
    penalty: 'guest.cancel.refund.penalty',
    fee: 'guest.cancel.refund.fee',
  };

function BreakdownPanel({ breakdown }: { breakdown: CancellationBreakdown }): ReactElement {
  return (
    <section
      data-testid="cancel-preview"
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}
      aria-labelledby="cancel-preview-title"
    >
      <h2 id="cancel-preview-title" style={{ margin: 0 }}>
        {t('guest.cancel.preview.title')}
      </h2>
      <p style={{ margin: 0 }} data-testid="cancel-tier">
        {t('guest.cancel.preview.tier', {
          tier: breakdown.appliedTierId,
          hours: formatHoursBeforeCheckIn(breakdown.hoursBeforeCheckIn),
          percent: breakdown.refundPercent,
        })}
      </p>
      <table data-testid="cancel-refund">
        <tbody>
          {refundRows(breakdown).map((row) => (
            <tr key={row.key}>
              <th scope="row" style={CELL}>
                {t(REFUND_KEYS[row.key])}
              </th>
              <td style={CELL}>{formatMoney(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CancelResult({ result }: { result: CancelResponse }): ReactElement {
  return (
    <section
      data-testid="cancel-result"
      aria-labelledby="cancel-result-title"
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}
    >
      <h2 id="cancel-result-title" style={{ margin: 0 }}>
        {t('guest.cancel.result.title')}
      </h2>
      <p style={{ margin: 0 }} data-testid="cancel-result-status">
        {formatStatusWithEnum(t(STATUS_KEYS[result.status]), result.status)}
      </p>
      <p style={{ margin: 0 }}>
        {t('guest.cancel.result.at', { time: formatDateTimeVn(result.cancelledAt) })}
      </p>
      <p style={{ margin: 0 }}>
        {t('guest.cancel.result.released', { count: result.releasedAssignmentCount })}
      </p>
      <p style={{ margin: 0 }} data-testid="cancel-result-refund">
        {result.refundRequest === null
          ? t('guest.cancel.result.noRefund')
          : t('guest.cancel.result.refund', {
              id: result.refundRequest.id,
              status: result.refundRequest.status,
              amount:
                result.refundRequest.approvedAmount === null
                  ? t('guest.cancel.result.refundPending')
                  : formatMoney(result.refundRequest.approvedAmount),
            })}
      </p>
      <Link href={`/bookings/${result.bookingId}`}>{t('guest.cancel.result.back')}</Link>
    </section>
  );
}

function CancelForm({
  reason,
  note,
  busy,
  confirmEnabled,
  onReason,
  onNote,
  onPreview,
  onConfirm,
}: {
  reason: CancelReason;
  note: string;
  busy: boolean;
  confirmEnabled: boolean;
  onReason: (value: CancelReason) => void;
  onNote: (value: string) => void;
  onPreview: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('guest.cancel.reason')}
        <select
          name="reason"
          value={reason}
          disabled={busy}
          onChange={(event) => {
            onReason(event.target.value === 'FORCE_MAJEURE' ? 'FORCE_MAJEURE' : 'GUEST_REQUEST');
          }}
        >
          {CANCEL_REASONS.map((value) => (
            <option key={value} value={value}>
              {t(CANCEL_REASON_KEYS[value])}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('guest.cancel.note')}
        <textarea
          name="note"
          maxLength={500}
          value={note}
          disabled={busy}
          onChange={(event) => {
            onNote(event.target.value);
          }}
        />
      </label>
      <p style={{ margin: 0 }}>{t('guest.cancel.previewRequired')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="cancel-preview-button"
          disabled={busy}
          onClick={onPreview}
        >
          {t('guest.cancel.preview.run')}
        </button>
        <button
          type="button"
          data-testid="cancel-confirm"
          disabled={!confirmEnabled}
          onClick={onConfirm}
        >
          {t('guest.cancel.confirm')}
        </button>
      </div>
    </div>
  );
}

function CancelOutcome({
  preview,
  result,
}: {
  preview: CancelPreview | null;
  result: CancelResponse | null;
}): ReactElement | null {
  if (result !== null) return <CancelResult result={result} />;
  if (preview === null) return null;
  return (
    <>
      <BreakdownPanel breakdown={preview.cancellation} />
      {preview.warnings === undefined ? null : (
        <ul data-testid="cancel-warnings" style={{ margin: 0 }}>
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function CancelMessages({ alert, stale }: { alert: string | null; stale: boolean }): ReactElement {
  return (
    <>
      {alert === null ? null : (
        <p role="alert" data-testid="cancel-alert" style={{ margin: 0 }}>
          {alert}
        </p>
      )}
      {!stale ? null : (
        <p role="status" data-testid="cancel-stale" style={{ margin: 0 }}>
          {t('guest.cancel.stale')}
        </p>
      )}
    </>
  );
}

export function CancelScreen(): ReactElement {
  const routeParams = useParams<{ bookingId: string }>();
  const bookingId = typeof routeParams.bookingId === 'string' ? routeParams.bookingId : '';

  const session = useMemo(() => createSessionClient({ kind: 'guest' }), []);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [step, setStep] = useState<CancelStep>('idle');
  const [reason, setReason] = useState<CancelReason>('GUEST_REQUEST');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [stale, setStale] = useState(false);
  const [result, setResult] = useState<CancelResponse | null>(null);
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
    if (action === 'reload-and-diff') setStale(true);
    setAlert(t(actionMessageKey(action)));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      setBooking(await fetchBooking(session, bookingId));
      setState({ kind: 'ready' });
    } catch (caught) {
      setState({ kind: 'ready' });
      failure(caught);
    }
  }, [bookingId, session, failure]);

  useEffect(() => {
    void load();
  }, [load]);

  const request = useCallback(
    () => ({ reason, isForceMajeure: claimsForceMajeure(reason) }),
    [reason],
  );

  const runPreview = useCallback(async (): Promise<void> => {
    setAlert(null);
    setStale(false);
    setStep('computing');
    try {
      setPreview(await fetchCancelPreview(session, bookingId, request()));
      setStep('previewed');
    } catch (caught) {
      setStep('idle');
      failure(caught);
    }
  }, [bookingId, session, request, failure]);

  const confirm = useCallback(async (): Promise<void> => {
    if (preview === null) return;
    setAlert(null);
    setStep('submitting');
    try {
      // AC1: đối chiếu lại ngay trước khi huỷ — số liệu đổi thì dừng, buộc xem trước lại.
      const fresh = await fetchCancelPreview(session, bookingId, request());
      if (!samePreview(fresh, preview)) {
        setPreview(fresh);
        setStale(true);
        setStep('previewed');
        return;
      }
      const trimmed = note.trim();
      const cancelled = await cancelBooking(session, bookingId, {
        ...request(),
        ...(trimmed === '' ? {} : { note: trimmed }),
      });
      setResult(cancelled);
      // Trạng thái trên dòng ngữ cảnh lấy từ chính kết quả máy chủ vừa trả, không đoán tại chỗ.
      setBooking((previous) =>
        previous === null ? previous : { ...previous, status: cancelled.status },
      );
      setStep('done');
    } catch (caught) {
      setStep('previewed');
      failure(caught);
    }
  }, [bookingId, note, preview, request, session, failure]);

  if (forbidden) return <AccessDeniedPanel backHref="/bookings" />;
  if (notFound) {
    return (
      <section
        role="alert"
        data-testid="cancel-not-found"
        style={{
          display: 'grid',
          gap: 'var(--space-s3, 12px)',
          padding: 'var(--space-s4, 16px) 0',
        }}
      >
        <h1 style={{ margin: 0 }}>{t('guest.cancel.title')}</h1>
        <p style={{ margin: 0 }}>{t('guest.booking.notFound')}</p>
        <Link href="/bookings">{t('guest.bookings.back')}</Link>
      </section>
    );
  }

  const busy = step === 'computing' || step === 'submitting';

  return (
    <section
      data-testid="cancel-screen"
      style={{ display: 'grid', gap: 'var(--space-s3, 12px)', padding: 'var(--space-s4, 16px) 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('guest.cancel.title')}</h1>
      <StateSurface state={state}>
        {booking === null ? null : (
          <p data-testid="cancel-booking" style={{ margin: 0 }}>
            <code>{booking.code}</code> ·{' '}
            {formatStatusWithEnum(t(STATUS_KEYS[booking.status]), booking.status)} ·{' '}
            {booking.checkIn} → {booking.checkOut} ·{' '}
            {formatStayPeriod(booking.nights, booking.adults, booking.children)}
          </p>
        )}

        {result === null ? (
          <CancelForm
            reason={reason}
            note={note}
            busy={busy}
            confirmEnabled={canConfirm(step)}
            onReason={setReason}
            onNote={setNote}
            onPreview={() => {
              void runPreview();
            }}
            onConfirm={() => {
              void confirm();
            }}
          />
        ) : null}

        <CancelMessages alert={alert} stale={stale} />

        <CancelOutcome preview={preview} result={result} />
      </StateSurface>
    </section>
  );
}
