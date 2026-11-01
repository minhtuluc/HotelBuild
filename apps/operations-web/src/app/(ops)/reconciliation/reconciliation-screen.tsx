'use client';

/**
 * SCR-39 (HB-111) — Đối soát doanh thu và chốt quỹ cuối ngày theo (người thu, ngày VN — BR-PAY-06, BR-PAY-10).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  ApiClient,
  createAuthApi,
  createFrontOfficeApi,
  createPropertyApi,
  createReportApi,
  isApiError,
} from '@pinehill/api-client';
import type {
  PinToken,
  PropertySummary,
  ReconciliationCloseResponse,
  RevenueByChannelReport,
} from '@pinehill/contracts';
import { StateSurface, formatMoney, type ScreenState } from '@pinehill/ui-web';
import { createSessionClient } from '@pinehill/web-session/client';
import { useForcedState } from '../../../components/forced-state';
import { ScreenAlert } from '../../../components/screen-alert';
import { t } from '../../../lib/i18n';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';
import {
  pinFailure,
  pinGrantValid,
  pinIssue,
  type PinStep,
} from '../bookings/[bookingId]/collect/collect-model';
import { PinDialog } from '../bookings/[bookingId]/collect/collect-parts';
import { opsReconcileText } from './messages';
import {
  canCloseReconciliation,
  cashIssue,
  defaultBusinessDate,
  hasDiscrepancyWarning,
  reconciliationRequestOf,
} from './model';

function ChannelSummarySection({
  report,
  operationId,
  onExport,
}: {
  report: RevenueByChannelReport | null;
  operationId: string | null;
  onExport: () => void;
}): ReactElement | null {
  if (report === null) return null;
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <h2 style={{ margin: 0 }}>{opsReconcileText('channelSection')}</h2>
      <div style={{ overflowX: 'auto' }}>
        <table data-testid="reconciliation-channel-table">
          <thead>
            <tr>
              <th scope="col">{opsReconcileText('channelCode')}</th>
              <th scope="col">{opsReconcileText('grossAmount')}</th>
              <th scope="col">{opsReconcileText('commissionAmount')}</th>
              <th scope="col">{opsReconcileText('netAmount')}</th>
              <th scope="col">{opsReconcileText('bookingsCount')}</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.channelCode}>
                <td>{row.channelCode}</td>
                <td>{formatMoney(row.grossAmount)}</td>
                <td>{formatMoney(row.commissionAmount)}</td>
                <td>{formatMoney(row.netAmount)}</td>
                <td>{row.bookings}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <button type="button" data-testid="reconciliation-export-csv" onClick={onExport}>
          {opsReconcileText('exportCsv')}
        </button>
      </div>
      {operationId === null ? null : (
        <p role="status" data-testid="reconciliation-export-status" style={{ margin: 0 }}>
          {opsReconcileText('exportAccepted', { id: operationId })}
        </p>
      )}
    </section>
  );
}

function ReconciliationResultCard({
  result,
}: {
  result: ReconciliationCloseResponse | null;
}): ReactElement | null {
  if (result === null) return null;
  return (
    <section
      data-testid="reconciliation-result"
      style={{ display: 'grid', gap: 6, border: '1px solid var(--color-border)', padding: 12 }}
    >
      <h2 style={{ margin: 0 }}>{opsReconcileText('resultTitle')}</h2>
      <p style={{ margin: 0 }}>
        {opsReconcileText('expectedCash', { amount: formatMoney(result.expectedCash) })}
      </p>
      <p style={{ margin: 0 }}>
        {opsReconcileText('countedCashResult', { amount: formatMoney(result.countedCash) })}
      </p>
      <p data-testid="reconciliation-difference" style={{ margin: 0 }}>
        {opsReconcileText('difference', { amount: formatMoney(result.difference) })}
      </p>
      <p style={{ margin: 0 }}>{opsReconcileText('auditRef', { id: result.auditLogId })}</p>
      {hasDiscrepancyWarning(result) ? (
        <p role="alert" data-testid="reconciliation-discrepancy-warning" style={{ margin: 0 }}>
          {opsReconcileText('discrepancyAlert')}
        </p>
      ) : null}
    </section>
  );
}

export function ReconciliationScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const pinToken = useRef<string | null>(null);
  const grant = useRef<PinToken | null>(null);
  const session = useRef<ReturnType<typeof createSessionClient> | null>(null);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [businessDate, setBusinessDate] = useState(() => defaultBusinessDate(new Date()));
  const [report, setReport] = useState<RevenueByChannelReport | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [countedCash, setCountedCash] = useState('0');
  const [note, setNote] = useState('');
  const [step, setStep] = useState<PinStep>('idle');
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [lockedMinutes, setLockedMinutes] = useState<number | null>(null);
  const [result, setResult] = useState<ReconciliationCloseResponse | null>(null);
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
      properties: createPropertyApi(client),
      reports: createReportApi(client),
      frontOffice: createFrontOfficeApi(client),
    };
  }, [baseUrl]);

  useEffect(() => () => session.current?.dispose(), []);

  const load = useCallback(
    async (targetPropertyId: string, targetDate: string): Promise<void> => {
      setError(null);
      setState({ kind: 'loading' });
      try {
        const [propRes, repRes] = await Promise.all([
          api.properties.list(),
          api.reports.revenueByChannel({
            from: targetDate,
            to: targetDate,
            ...(targetPropertyId === '' ? {} : { propertyId: targetPropertyId }),
          }),
        ]);
        const list = propRes.data.data;
        setProperties(list);
        if (targetPropertyId === '' && list[0] !== undefined) setPropertyId(list[0].id);
        setReport(repRes.data);
        setState({ kind: 'ready' });
      } catch (caught) {
        const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
        setState(mapped ?? { kind: 'ready' });
        if (mapped === undefined) setError(caught);
      }
    },
    [api],
  );

  useEffect(() => {
    if (forced === undefined) void load('', businessDate);
  }, [forced, load, businessDate]);

  const verifyPin = async (): Promise<void> => {
    if (pinIssue(pin) !== null) return;
    setBusy(true);
    setWrong(false);
    setUnavailable(false);
    try {
      const token = (await api.auth.pinVerify(pin)).data;
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

  const submitClose = async (): Promise<void> => {
    const issue = cashIssue(countedCash);
    if (!canCloseReconciliation(step, issue, propertyId, businessDate)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.frontOffice.closeReconciliation(
        reconciliationRequestOf({ propertyId, businessDate, countedCash, note }),
      );
      setResult(res.data);
      pinToken.current = null;
      setStep('idle');
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: '—',
          onReload: () => void load(propertyId, businessDate),
          onLookup: () => void load(propertyId, businessDate),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async (): Promise<void> => {
    try {
      const ref = await api.reports.export({
        report: 'revenue-by-channel',
        format: 'CSV',
        params: { from: businessDate, to: businessDate },
      });
      setOperationId(ref.data.operationId);
    } catch (caught) {
      setError(caught);
    }
  };

  if (forced !== undefined) {
    return (
      <section data-testid="reconciliation-screen" style={{ display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{opsReconcileText('reconcileTitle')}</h1>
        <StateSurface state={forced}>
          <p>{t('screen.demo')}</p>
        </StateSurface>
      </section>
    );
  }

  const issue = cashIssue(countedCash);
  const canSubmit = canCloseReconciliation(step, issue, propertyId, businessDate);

  return (
    <section
      data-testid="reconciliation-screen"
      style={{ display: 'grid', gap: 16, padding: '16px 0' }}
    >
      <h1 style={{ margin: 0 }}>{opsReconcileText('reconcileTitle')}</h1>
      <p style={{ margin: 0 }}>{opsReconcileText('reconcileIntro')}</p>
      <StateSurface state={state}>
        {error === null ? null : (
          <ScreenAlert error={error} onRetry={() => void load(propertyId, businessDate)} />
        )}
        <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            {opsReconcileText('property')}
            <select
              name="propertyId"
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
            >
              {properties.map((prop) => (
                <option key={prop.id} value={prop.id}>
                  {prop.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {opsReconcileText('businessDate')}
            <input
              name="businessDate"
              type="date"
              value={businessDate}
              onChange={(event) => setBusinessDate(event.target.value)}
            />
          </label>
          <button
            type="button"
            data-testid="reconciliation-reload"
            onClick={() => void load(propertyId, businessDate)}
          >
            {opsReconcileText('reload')}
          </button>
        </div>
        <ChannelSummarySection
          report={report}
          operationId={operationId}
          onExport={() => void exportCsv()}
        />
        <section style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
          <h2 style={{ margin: 0 }}>{opsReconcileText('closeSection')}</h2>
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
          <label style={{ display: 'grid', gap: 4 }}>
            {opsReconcileText('countedCash')}
            <input
              name="countedCash"
              inputMode="numeric"
              value={countedCash}
              disabled={busy}
              onChange={(event) => setCountedCash(event.target.value)}
            />
          </label>
          {issue === null ? null : (
            <p role="alert" data-testid="reconciliation-cash-issue" style={{ margin: 0 }}>
              {opsReconcileText('cashIssue')}
            </p>
          )}
          <label style={{ display: 'grid', gap: 4 }}>
            {opsReconcileText('note')}
            <input
              name="note"
              maxLength={500}
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button
            type="button"
            data-testid="reconciliation-submit"
            disabled={busy || !canSubmit}
            onClick={() => void submitClose()}
          >
            {opsReconcileText('submitClose')}
          </button>
        </section>
        <ReconciliationResultCard result={result} />
      </StateSurface>
    </section>
  );
}
