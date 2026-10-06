'use client';

/**
 * SCR-54 — Báo cáo huỷ phòng & hoàn cọc (UC-REP-03, BR-REP-01, BR-CANCEL-01, BR-CANCEL-13).
 * Tỷ lệ huỷ và tiền hoàn theo gói/bậc đọc nguyên từ máy chủ; dòng tổng chỉ **cộng** các số máy chủ trả.
 * Xuất CSV/XLSX là tác vụ bất đồng bộ `202` + theo dõi `operationId` (NFR-COMP-04).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  createPropertyApi,
  createReportApi,
  createSystemApi,
  isApiError,
} from '@pinehill/api-client';
import type {
  CancellationsReport,
  OperationStatusView,
  PropertySummary,
  RatePlanCode,
  ReportExportRequest,
} from '@pinehill/contracts';
import { StateSurface, formatMoney, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../../components/screen-alert';
import { useForcedState } from '../../../../components/forced-state';
import { opsApiClient } from '../../../../lib/api';
import { t } from '../../../../lib/i18n';
import { defaultRange } from '../../../../lib/inventory-grid';
import { readFailureState, writeFailureState } from '../../../../lib/screen-state';
import { CancellationsTable, OperationPanel } from '../report-tables';
import {
  cancellationsTotals,
  exportRequest,
  filtersToParams,
  isTerminal,
  rangeIssue,
  type ReportFilters,
} from '../report-shared';

const POLL_INTERVAL_MS = 1_000;
const POLL_MAX_ATTEMPTS = 30;
const RATE_PLANS: readonly RatePlanCode[] = ['FLEX7', 'SAVER3', 'NONREF', 'LONGSTAY14'];

const ROW_STYLE = {
  display: 'flex',
  gap: 'var(--space-s2, 8px)',
  flexWrap: 'wrap',
  alignItems: 'end',
} as const;

const FIELD_STYLE = { display: 'grid', gap: 4 } as const;

function initialFilters(): ReportFilters {
  return { propertyId: '', ...defaultRange(new Date(), 7), groupBy: 'DAY' };
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function ratePlanOf(value: string): RatePlanCode | '' {
  return RATE_PLANS.find((code) => code === value) ?? '';
}

export function CancellationsReportScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [initial] = useState<ReportFilters>(initialFilters);
  const [draft, setDraft] = useState<ReportFilters>(initial);
  const [applied, setApplied] = useState<ReportFilters>(initial);
  const [ratePlan, setRatePlan] = useState<RatePlanCode | ''>('');
  const [appliedRatePlan, setAppliedRatePlan] = useState<RatePlanCode | ''>('');
  const [report, setReport] = useState<CancellationsReport | null>(null);
  const [operation, setOperation] = useState<OperationStatusView | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const canExport = state.kind !== 'forbidden';

  const load = useCallback(
    async (filters: ReportFilters, plan: RatePlanCode | ''): Promise<void> => {
      setReadError(null);
      const issue = rangeIssue(filters.from, filters.to);
      if (issue !== null) {
        setState({ kind: 'validationError', details: [issue] });
        return;
      }
      try {
        const [loaded, propertiesPage] = await Promise.all([
          createReportApi(opsApiClient(baseUrl)).cancellations({
            from: filters.from,
            to: filters.to,
            ...(filters.propertyId === '' ? {} : { propertyId: filters.propertyId }),
            ...(plan === '' ? {} : { ratePlanCode: plan }),
          }),
          createPropertyApi(opsApiClient(baseUrl)).list(),
        ]);
        setProperties(propertiesPage.data.data);
        setReport(loaded.data);
        setState(
          loaded.data.rows.length === 0
            ? { kind: 'empty', reason: 'noData', canCreate: false }
            : { kind: 'ready' },
        );
      } catch (caught) {
        const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
        if (mapped !== undefined) {
          setState(mapped);
          return;
        }
        setReadError(caught);
        setState({ kind: 'ready' });
      }
    },
    [baseUrl],
  );

  useEffect(() => {
    if (forced !== undefined) return;
    void load(applied, appliedRatePlan);
  }, [forced, load, applied, appliedRatePlan]);

  /** Hỏi trạng thái tác vụ cho tới khi kết thúc (SLA xuất ≥ 100.000 dòng ≤ 60 s). */
  const poll = async (operationId: string): Promise<void> => {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
      const view = (await createSystemApi(opsApiClient(baseUrl)).operation(operationId)).data;
      setOperation(view);
      if (isTerminal(view.status)) return;
      await delay(POLL_INTERVAL_MS);
    }
  };

  const runExport = async (format: ReportExportRequest['format']): Promise<void> => {
    setOperation(null);
    try {
      const params = filtersToParams(applied);
      if (appliedRatePlan !== '') params.ratePlanCode = appliedRatePlan;
      const ref = await createReportApi(opsApiClient(baseUrl)).export(
        exportRequest('cancellations', format, params),
      );
      setOperation(ref.data);
      await poll(ref.data.operationId);
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: '—',
          onReload: () => void load(applied, appliedRatePlan),
          onLookup: () => void load(applied, appliedRatePlan),
        }),
      );
    }
  };

  if (forced !== undefined) {
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  }

  const totals = report === null ? null : cancellationsTotals(report.rows);

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('reports.cancel.title')}</h1>
      <p style={{ margin: 0 }}>{t('reports.cancel.intro')}</p>
      <form
        data-testid="cancel-filters"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          setApplied(draft);
          setAppliedRatePlan(ratePlan);
        }}
        style={ROW_STYLE}
      >
        <label style={FIELD_STYLE}>
          {t('reports.filters.property')}
          <select
            name="propertyId"
            value={draft.propertyId}
            onChange={(event) => setDraft({ ...draft, propertyId: event.target.value })}
          >
            <option value="">{t('reports.filters.property')}</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
        <label style={FIELD_STYLE}>
          {t('reports.filters.from')}
          <input
            name="from"
            type="date"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </label>
        <label style={FIELD_STYLE}>
          {t('reports.filters.to')}
          <input
            name="to"
            type="date"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <label style={FIELD_STYLE}>
          {t('reports.col.ratePlan')}
          <select
            name="ratePlanCode"
            value={ratePlan}
            onChange={(event) => setRatePlan(ratePlanOf(event.target.value))}
          >
            <option value="">{t('reports.col.ratePlan')}</option>
            {RATE_PLANS.map((code) => (
              <option key={code} value={code}>
                {t(`enum.ratePlanCode.${code}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">{t('reports.filters.load')}</button>
      </form>
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(applied, appliedRatePlan)} />
        )}
        {operation === null ? null : <OperationPanel view={operation} />}
        {report === null || totals === null ? null : (
          <>
            <p role="status" data-testid="cancel-summary" style={{ margin: 0 }}>
              {t('reports.cancel.rate', { rate: report.cancellationRate })} ·{' '}
              {t('reports.cancel.cases', { count: totals.cancellations })} ·{' '}
              {t('reports.cancel.refundTotal', { amount: formatMoney(totals.refundAmount) })}
            </p>
            <CancellationsTable report={report} />
            {canExport ? (
              <div style={ROW_STYLE}>
                <button type="button" onClick={() => void runExport('CSV')}>
                  {t('reports.export.csv')}
                </button>
                <button type="button" onClick={() => void runExport('XLSX')}>
                  {t('reports.export.xlsx')}
                </button>
              </div>
            ) : null}
          </>
        )}
      </StateSurface>
    </section>
  );
}
