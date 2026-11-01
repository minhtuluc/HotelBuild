'use client';

/**
 * SCR-69 (HB-111) — Xử lý trả phòng sớm (thiết kế màn hình §2 dòng 247, UC-FO-02, BR-CANCEL-09).
 * Hai bước bắt buộc: xem trước phụ thu/số dư từ máy chủ (`POST /front-office/check-out/preview`) + xác thực
 * PIN 6 chữ số rồi mới mở nút xác nhận trả phòng sớm (`POST /front-office/check-out`).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ApiClient,
  createAuthApi,
  createBookingApi,
  createFrontOfficeApi,
  isApiError,
} from '@pinehill/api-client';
import type {
  BookingSummary,
  CheckOutPreview,
  CheckOutResponse,
  PinToken,
} from '@pinehill/contracts';
import { StateSurface, formatDateTimeVn, formatMoney, type ScreenState } from '@pinehill/ui-web';
import { createSessionClient } from '@pinehill/web-session/client';
import { useForcedState } from '../../../../../components/forced-state';
import { ScreenAlert } from '../../../../../components/screen-alert';
import { t } from '../../../../../lib/i18n';
import { readFailureState, writeFailureState } from '../../../../../lib/screen-state';
import { opsReconcileText } from '../../../reconciliation/messages';
import {
  canConfirmEarlyCheckout,
  earlyCheckoutPreviewRequestOf,
} from '../../../reconciliation/model';
import { pinFailure, pinGrantValid, pinIssue, type PinStep } from '../collect/collect-model';
import { PinDialog } from '../collect/collect-parts';

function PreviewCard({ preview }: { preview: CheckOutPreview | null }): ReactElement | null {
  if (preview === null) return null;
  return (
    <section
      data-testid="early-checkout-preview"
      style={{ display: 'grid', gap: 6, border: '1px solid var(--color-border)', padding: 12 }}
    >
      <h2 style={{ margin: 0 }}>{opsReconcileText('previewTitle')}</h2>
      <p data-testid="early-checkout-fee" style={{ margin: 0 }}>
        {opsReconcileText('feeAmount', { amount: formatMoney(preview.feeAmount) })}
      </p>
      <p style={{ margin: 0 }}>
        {opsReconcileText('extrasAmount', { amount: formatMoney(preview.extrasAmount) })}
      </p>
      <p data-testid="early-checkout-balance" style={{ margin: 0 }}>
        {opsReconcileText('balanceDueAfter', { amount: formatMoney(preview.balanceDue) })}
      </p>
    </section>
  );
}

function ResultCard({ result }: { result: CheckOutResponse | null }): ReactElement | null {
  if (result === null) return null;
  return (
    <section
      data-testid="early-checkout-result"
      style={{ display: 'grid', gap: 6, border: '1px solid var(--color-border)', padding: 12 }}
    >
      <h2 style={{ margin: 0 }}>{opsReconcileText('doneTitle')}</h2>
      <p style={{ margin: 0 }}>
        {opsReconcileText('doneStatus', {
          status: result.status,
          time: formatDateTimeVn(result.checkedOutAt),
        })}
      </p>
      <p style={{ margin: 0 }}>
        {opsReconcileText('feeAmount', { amount: formatMoney(result.feeAmount) })}
      </p>
      <p style={{ margin: 0 }}>
        {opsReconcileText('balanceDueAfter', { amount: formatMoney(result.balanceDue) })}
      </p>
      <p data-testid="early-checkout-tasks" style={{ margin: 0 }}>
        {opsReconcileText('doneTasks', { count: result.housekeepingTaskIds.length })}
      </p>
    </section>
  );
}

export function EarlyCheckoutScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const params = useParams<{ bookingId: string }>();
  const bookingId = typeof params.bookingId === 'string' ? params.bookingId : '';
  const pinToken = useRef<string | null>(null);
  const grant = useRef<PinToken | null>(null);
  const session = useRef<ReturnType<typeof createSessionClient> | null>(null);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<CheckOutPreview | null>(null);
  const [result, setResult] = useState<CheckOutResponse | null>(null);
  const [step, setStep] = useState<PinStep>('idle');
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [lockedMinutes, setLockedMinutes] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const api = useMemo(() => {
    const client = new ApiClient({
      baseUrl,
      maxAttempts: 2,
      getPinToken: () => pinToken.current,
      getAccessToken: async () => {
        session.current ??= createSessionClient({
          kind: 'staff',
          onExpired: () => setState({ kind: 'forbidden' }),
        });
        return await session.current.getAccessToken();
      },
    });
    return {
      auth: createAuthApi(client),
      bookings: createBookingApi(client),
      frontOffice: createFrontOfficeApi(client),
    };
  }, [baseUrl]);

  useEffect(() => () => session.current?.dispose(), []);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setState({ kind: 'loading' });
    try {
      const loaded = await api.bookings.get(bookingId);
      setBooking(loaded.data);
      setState({ kind: 'ready' });
    } catch (caught) {
      const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
      setState(mapped ?? { kind: 'ready' });
      if (mapped === undefined) setError(caught);
    }
  }, [api, bookingId]);

  useEffect(() => {
    if (forced === undefined) void load();
  }, [forced, load]);

  const runPreview = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.frontOffice.checkOutPreview(
        earlyCheckoutPreviewRequestOf(bookingId, note),
      );
      setPreview(res.data);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const verifyPin = async (): Promise<void> => {
    if (pinIssue(pin) !== null) return;
    setBusy(true);
    setWrong(false);
    setUnavailable(false);
    try {
      const token = (await api.auth.pinVerify(pin, bookingId)).data;
      if (pinGrantValid(token, Date.now())) {
        grant.current = token;
        pinToken.current = token.pinToken;
        setStep('verified');
      }
    } catch (caught) {
      const failure = pinFailure(caught, isApiError);
      setStep(failure.locked ? 'locked' : 'idle');
      setLockedMinutes(
        failure.retryAfterSeconds === null ? null : Math.ceil(failure.retryAfterSeconds / 60),
      );
      if (!failure.locked) setWrong(true);
    } finally {
      setPin('');
      setBusy(false);
    }
  };

  const confirmEarly = async (): Promise<void> => {
    if (!canConfirmEarlyCheckout(step, preview)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.frontOffice.checkOut(earlyCheckoutPreviewRequestOf(bookingId, note));
      setResult(res.data);
      pinToken.current = null;
      setStep('idle');
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
  };

  if (forced !== undefined) {
    return (
      <section data-testid="early-checkout-screen" style={{ display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{opsReconcileText('earlyTitle')}</h1>
        <StateSurface state={forced}>
          <p>{t('screen.demo')}</p>
        </StateSurface>
      </section>
    );
  }

  return (
    <section
      data-testid="early-checkout-screen"
      style={{ display: 'grid', gap: 12, padding: '16px 0' }}
    >
      <h1 style={{ margin: 0 }}>{opsReconcileText('earlyTitle')}</h1>
      <p style={{ margin: 0 }}>{opsReconcileText('earlyIntro')}</p>
      <Link href={`/bookings/${encodeURIComponent(bookingId)}`} data-testid="early-checkout-back">
        {opsReconcileText('backToBooking')}
      </Link>
      <StateSurface state={state}>
        {error === null ? null : <ScreenAlert error={error} onRetry={() => void load()} />}
        {booking === null ? null : (
          <div data-testid="early-checkout-booking" style={{ display: 'grid', gap: 4 }}>
            <p style={{ margin: 0 }}>
              {opsReconcileText('bookingInfo', {
                code: booking.code,
                status: booking.status,
                checkIn: booking.checkIn,
                checkOut: booking.checkOut,
              })}
            </p>
            <p style={{ margin: 0 }}>
              {opsReconcileText('bookingAmounts', {
                total: formatMoney(booking.totalAmount),
                paid: formatMoney(booking.paidAmount),
                due: formatMoney(booking.balanceDue),
              })}
            </p>
          </div>
        )}
        <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            {opsReconcileText('earlyNote')}
            <input
              name="note"
              maxLength={500}
              value={note}
              disabled={busy}
              onChange={(event) => {
                setNote(event.target.value);
                setPreview(null);
              }}
            />
          </label>
          <button
            type="button"
            data-testid="early-checkout-preview-button"
            disabled={busy}
            onClick={() => void runPreview()}
          >
            {opsReconcileText('previewButton')}
          </button>
          <PreviewCard preview={preview} />
          <PinDialog
            step={step}
            pin={pin}
            issue={pinIssue(pin)}
            lockedMinutes={lockedMinutes}
            wrong={wrong}
            unavailable={unavailable}
            busy={busy}
            onPin={setPin}
            onSubmit={() => void verifyPin()}
          />
          <button
            type="button"
            data-testid="early-checkout-confirm"
            disabled={busy || !canConfirmEarlyCheckout(step, preview)}
            onClick={() => void confirmEarly()}
          >
            {opsReconcileText('confirmEarly')}
          </button>
        </div>
        <ResultCard result={result} />
      </StateSurface>
    </section>
  );
}
