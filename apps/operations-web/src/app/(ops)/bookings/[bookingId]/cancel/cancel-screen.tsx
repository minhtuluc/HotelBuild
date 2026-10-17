'use client';

/**
 * SCR-36 (HB-108) — huỷ booking & tính hoàn theo bậc cho back-office.
 *
 * **Hai bước bắt buộc** (AC1): chọn lý do → "Xem trước số tiền hoàn" (`POST .../cancel-preview`, kèm tải
 * chính sách để hiện thang bậc §4.6) → mới mở nút xác nhận. Ngay trước khi huỷ, màn hình đối chiếu lại
 * với máy chủ; số liệu đổi (qua mốc/version) thì **không** huỷ mà hiện số mới để lễ tân xác nhận lại.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';
import { createBookingApi, createRateApi, isApiError } from '@pinehill/api-client';
import type {
  BookingSummary,
  CancelPreview,
  CancelResponse,
  CancellationPolicy,
} from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../../../components/screen-alert';
import { useForcedState } from '../../../../../components/forced-state';
import { useOpsSession } from '../../../../../lib/ops-session';
import { formatBusinessDate } from '../../../../../lib/business-date';
import { t } from '../../../../../lib/i18n';
import { readFailureState, writeFailureState } from '../../../../../lib/screen-state';
import { CancelForm, CancelPreviewPanel, CancelResult } from './cancel-parts';
import {
  EMPTY_CANCEL_DRAFT,
  canConfirmCancel,
  cancelRequestOf,
  previewRequestOf,
  samePreview,
  type CancelDraft,
  type CancelStep,
} from './cancel-model';

function CancelBody({
  step,
  draft,
  booking,
  preview,
  policy,
  result,
  busy,
  onChange,
  onPreview,
  onConfirm,
}: {
  step: CancelStep;
  draft: CancelDraft;
  booking: BookingSummary | null;
  preview: CancelPreview | null;
  policy: CancellationPolicy | null;
  result: CancelResponse | null;
  busy: boolean;
  onChange: (patch: Partial<CancelDraft>) => void;
  onPreview: () => void;
  onConfirm: () => void;
}): ReactElement {
  if (result !== null) return <CancelResult result={result} />;
  return (
    <>
      <CancelForm
        draft={draft}
        busy={busy}
        canConfirm={canConfirmCancel(step)}
        onChange={onChange}
        onPreview={onPreview}
        onConfirm={onConfirm}
      />
      {preview === null ? null : <CancelPreviewPanel preview={preview} policy={policy} />}
      {booking === null ? null : null}
    </>
  );
}

export function CancelScreen(): ReactElement {
  const forced = useForcedState();
  const params = useParams<{ bookingId: string }>();
  const bookingId = typeof params.bookingId === 'string' ? params.bookingId : '';
  const session = useOpsSession(['/bookings', '/cancellation-policies'], {
    onExpired: () => setState({ kind: 'forbidden' }),
  });
  const api = useMemo(() => {
    const client = session.client;
    return { bookings: createBookingApi(client), rate: createRateApi(client) };
  }, [session]);

  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [step, setStep] = useState<CancelStep>('choose');
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [draft, setDraft] = useState<CancelDraft>(EMPTY_CANCEL_DRAFT);
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [policy, setPolicy] = useState<CancellationPolicy | null>(null);
  const [result, setResult] = useState<CancelResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setState({ kind: 'loading' });
    try {
      setBooking((await api.bookings.get(bookingId)).data);
      setState({ kind: 'ready' });
    } catch (caught) {
      const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
      setState(mapped ?? { kind: 'ready' });
      if (mapped === undefined) setError(caught);
    }
  }, [api, bookingId]);

  useEffect(() => {
    if (forced !== undefined) return;
    void load();
  }, [forced, load]);

  /** Tải chính sách để hiện thang bậc (§4.6) — chỉ để hiển thị, không tính lại tiền. */
  const loadPolicy = useCallback(
    async (policyId: string): Promise<void> => {
      try {
        const page = (await api.rate.listCancellationPolicies()).data;
        setPolicy(page.data.find((item) => item.id === policyId) ?? null);
      } catch {
        setPolicy(null);
      }
    },
    [api],
  );

  const change = useCallback((patch: Partial<CancelDraft>): void => {
    setDraft((previous) => ({ ...previous, ...patch }));
  }, []);

  const runPreview = useCallback(async (): Promise<void> => {
    setError(null);
    setStale(false);
    setStep('computing');
    setBusy(true);
    try {
      const loaded = (await api.bookings.cancelPreview(bookingId, previewRequestOf(draft))).data;
      setPreview(loaded);
      await loadPolicy(loaded.cancellation.policyId);
      setStep('previewed');
    } catch (caught) {
      setStep('choose');
      setError(caught);
    } finally {
      setBusy(false);
    }
  }, [api, bookingId, draft, loadPolicy]);

  const confirm = useCallback(async (): Promise<void> => {
    if (preview === null) return;
    setError(null);
    setStep('submitting');
    setBusy(true);
    try {
      // AC1: đối chiếu lại ngay trước khi huỷ; số liệu đổi thì dừng và buộc xác nhận lại.
      const fresh = (await api.bookings.cancelPreview(bookingId, previewRequestOf(draft))).data;
      if (!samePreview(fresh, preview)) {
        setPreview(fresh);
        setStale(true);
        setStep('previewed');
        return;
      }
      setResult((await api.bookings.cancel(bookingId, cancelRequestOf(draft))).data);
      setStep('done');
    } catch (caught) {
      setStep('previewed');
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
  }, [api, bookingId, draft, load, preview]);

  if (forced !== undefined) {
    return (
      <section data-testid="cancel-screen" style={{ display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{t('ops.cancel.title')}</h1>
        <StateSurface state={forced} />
      </section>
    );
  }

  return (
    <section data-testid="cancel-screen" style={{ display: 'grid', gap: 12, padding: '16px 0' }}>
      <h1 style={{ margin: 0 }}>{t('ops.cancel.title')}</h1>
      {booking === null ? null : (
        <p data-testid="cancel-booking" style={{ margin: 0 }}>
          <code>{booking.code}</code> · {booking.status} · {formatBusinessDate(booking.checkIn)} →{' '}
          {formatBusinessDate(booking.checkOut)} · {booking.roomCount} {t('ops.cancel.rooms')}
        </p>
      )}
      <StateSurface state={state}>
        {error === null ? null : <ScreenAlert error={error} onRetry={() => void load()} />}
        {stale ? (
          <p role="status" data-testid="cancel-stale" style={{ margin: 0 }}>
            {t('ops.cancel.stale')}
          </p>
        ) : null}
        <CancelBody
          step={step}
          draft={draft}
          booking={booking}
          preview={preview}
          policy={policy}
          result={result}
          busy={busy}
          onChange={change}
          onPreview={() => void runPreview()}
          onConfirm={() => void confirm()}
        />
      </StateSurface>
    </section>
  );
}
