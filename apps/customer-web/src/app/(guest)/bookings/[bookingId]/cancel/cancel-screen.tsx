'use client';

/**
 * SCR-11 — huỷ đặt phòng & số tiền hoàn theo bậc (UC-BOOK-08, TC-SYS-10).
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
  mapErrorToUiAction,
  type ScreenState,
} from '@pinehill/ui-web';
import { useT, useTranslators } from '../../../../../i18n/client';
import type { CustomerMessageKey } from '../../../../../i18n/catalogs';
import { fetchBooking } from '../../../booking/booking-api';
import { fetchCancelPreview, cancelBooking } from '../../api';
import { STATUS_KEYS, stayText } from '../../model';
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

const REFUND_KEYS: Readonly<Record<'paid' | 'requested' | 'penalty' | 'fee', CustomerMessageKey>> =
  {
    paid: 'guest.cancel.refund.paid',
    requested: 'guest.cancel.refund.requested',
    penalty: 'guest.cancel.refund.penalty',
    fee: 'guest.cancel.refund.fee',
  };

function BreakdownPanel({ breakdown }: { breakdown: CancellationBreakdown }): ReactElement {
  const t = useT();
  return (
    <section
      data-testid="cancel-preview"
      className="ph-card"
      style={{ display: 'grid', gap: 12 }}
      aria-labelledby="cancel-preview-title"
    >
      <h2 id="cancel-preview-title" style={{ margin: 0, fontSize: 'var(--text-h2, 18px)' }}>
        {t('guest.cancel.preview.title')}
      </h2>
      <p style={{ margin: 0, color: 'var(--color-textMuted)' }} data-testid="cancel-tier">
        {t('guest.cancel.preview.tier', {
          tier: breakdown.appliedTierId,
          hours: formatHoursBeforeCheckIn(breakdown.hoursBeforeCheckIn),
          percent: breakdown.refundPercent,
        })}
      </p>
      <div className="ph-table-wrap">
        <table data-testid="cancel-refund">
          <tbody>
            {refundRows(breakdown).map((row) => (
              <tr key={row.key}>
                <th scope="row">{t(REFUND_KEYS[row.key])}</th>
                <td
                  className="ph-tabular"
                  style={{ fontWeight: row.key === 'requested' ? 500 : 400 }}
                >
                  {formatMoney(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CancelResult({ result }: { result: CancelResponse }): ReactElement {
  const t = useT();
  return (
    <section
      data-testid="cancel-result"
      aria-labelledby="cancel-result-title"
      className="ph-card"
      style={{ display: 'grid', gap: 12 }}
    >
      <h2 id="cancel-result-title" style={{ margin: 0, fontSize: 'var(--text-h2, 18px)' }}>
        {t('guest.cancel.result.title')}
      </h2>
      <ul className="ph-list-lines ph-tabular">
        <li>
          <span>{t('guest.bookings.col.status')}</span>
          <strong data-testid="cancel-result-status">
            {formatStatusWithEnum(t(STATUS_KEYS[result.status]), result.status)}
          </strong>
        </li>
        <li>
          <span>{t('guest.cancel.result.at', { time: formatDateTimeVn(result.cancelledAt) })}</span>
          <span>
            {t('guest.cancel.result.released', { count: result.releasedAssignmentCount })}
          </span>
        </li>
      </ul>
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
      <div>
        <Link href={`/bookings/${result.bookingId}`} className="ph-btn">
          {t('guest.cancel.result.back')}
        </Link>
      </div>
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
  const t = useT();
  return (
    <div className="ph-card" style={{ display: 'grid', gap: 16 }}>
      <label className="ph-field">
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
      <label className="ph-field">
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
      <p style={{ margin: 0, fontSize: 14, color: 'var(--color-textMuted)' }}>
        {t('guest.cancel.previewRequired')}
      </p>
      <div className="ph-actions">
        <button
          type="button"
          data-testid="cancel-preview-button"
          className="ph-btn"
          disabled={busy}
          onClick={onPreview}
        >
          {t('guest.cancel.preview.run')}
        </button>
        <button
          type="button"
          data-testid="cancel-confirm"
          className="ph-btn-danger"
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
        <ul
          data-testid="cancel-warnings"
          className="ph-muted-box"
          style={{ margin: 0, paddingLeft: 32 }}
        >
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function CancelMessages({ alert, stale }: { alert: string | null; stale: boolean }): ReactElement {
  const t = useT();
  return (
    <>
      {alert === null ? null : (
        <p role="alert" data-testid="cancel-alert" className="ph-alert-box" style={{ margin: 0 }}>
          {alert}
        </p>
      )}
      {!stale ? null : (
        <p role="status" data-testid="cancel-stale" className="ph-alert-box" style={{ margin: 0 }}>
          {t('guest.cancel.stale')}
        </p>
      )}
    </>
  );
}

export function CancelScreen(): ReactElement {
  const text = useTranslators();
  const t = useT();
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
      setBooking((previous) =>
        previous === null ? previous : { ...previous, status: cancelled.status },
      );
      setStep('done');
    } catch (caught) {
      setStep('previewed');
      failure(caught);
    }
  }, [bookingId, note, preview, request, session, failure]);

  if (forbidden)
    return (
      <div className="ph-page-shell">
        <AccessDeniedPanel backHref="/bookings" />
      </div>
    );
  if (notFound) {
    return (
      <section role="alert" data-testid="cancel-not-found" className="ph-page-shell">
        <div className="ph-page-header">
          <h1 className="ph-page-title">{t('guest.cancel.title')}</h1>
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

  const busy = step === 'computing' || step === 'submitting';

  return (
    <section data-testid="cancel-screen" className="ph-page-shell">
      <div className="ph-page-header">
        <h1 className="ph-page-title">{t('guest.cancel.title')}</h1>
      </div>
      <StateSurface state={state}>
        {booking === null ? null : (
          <p data-testid="cancel-booking" className="ph-muted-box ph-tabular" style={{ margin: 0 }}>
            <span>
              <code>{booking.code}</code> ·{' '}
              {formatStatusWithEnum(t(STATUS_KEYS[booking.status]), booking.status)} ·{' '}
              {stayText(text, booking)}
            </span>
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
