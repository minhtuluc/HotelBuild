'use client';

/**
 * SCR-53 — Báo cáo doanh thu theo kênh (UC-REP-02, BR-REP-01, BR-RATE-08).
 * Số theo từng kênh đọc nguyên từ máy chủ (snapshot giá/hoa hồng lúc bán, không đọc cấu hình hiện tại);
 * dòng tổng chỉ **cộng** các con số máy chủ trả. Xuất CSV/XLSX là tác vụ bất đồng bộ (NFR-COMP-04).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  createPropertyApi,
  createReportApi,
  createSystemApi,
  isApiError,
} from '@pinehill/api-client';
import type {
  OperationStatusView,
  PropertySummary,
  ReportExportRequest,
  RevenueByChannelReport,
} from '@pinehill/contracts';
import { StateSurface, formatMoney, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../../components/screen-alert';
import { useForcedState } from '../../../../components/forced-state';
import { t } from '../../../../lib/i18n';
import { defaultRange } from '../../../../lib/inventory-grid';
import { useOpsSession } from '../../../../lib/ops-session';
import { readFailureState, writeFailureState } from '../../../../lib/screen-state';
import { OperationPanel, RevenueByChannelTable } from '../report-tables';
import {
  exportRequest,
  filtersToParams,
  isTerminal,
  rangeIssue,
  revenueTotals,
  type ReportFilters,
} from '../report-shared';

const POLL_INTERVAL_MS = 1_000;
const POLL_MAX_ATTEMPTS = 30;

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

export function RevenueByChannelScreen(): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [initial] = useState<ReportFilters>(initialFilters);
  const [draft, setDraft] = useState<ReportFilters>(initial);
  const [applied, setApplied] = useState<ReportFilters>(initial);
  const [report, setReport] = useState<RevenueByChannelReport | null>(null);
  const [operation, setOperation] = useState<OperationStatusView | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const canExport = state.kind !== 'forbidden';
  const session = useOpsSession(['/reports', '/properties', '/operations'], {
    onExpired: () => {
      setReport(null);
      setOperation(null);
      setState({ kind: 'forbidden' });
    },
  });

  const load = useCallback(
    async (filters: ReportFilters): Promise<void> => {
      setReadError(null);
      const issue = rangeIssue(filters.from, filters.to);
      if (issue !== null) {
        setState({ kind: 'validationError', details: [issue] });
        return;
      }
      try {
        const api = createReportApi(session.client);
        const [loaded, propertiesPage] = await Promise.all([
          api.revenueByChannel({
            from: filters.from,
            to: filters.to,
            ...(filters.propertyId === '' ? {} : { propertyId: filters.propertyId }),
          }),
          createPropertyApi(session.client).list(),
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
    [session],
  );

  useEffect(() => {
    if (forced !== undefined) return;
    void load(applied);
  }, [forced, load, applied]);

  /** Hỏi trạng thái tác vụ cho tới khi kết thúc (SLA xuất ≥ 100.000 dòng ≤ 60 s). */
  const poll = async (operationId: string): Promise<void> => {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
      const view = (await createSystemApi(session.client).operation(operationId)).data;
      setOperation(view);
      if (isTerminal(view.status)) return;
      await delay(POLL_INTERVAL_MS);
    }
  };

  const runExport = async (format: ReportExportRequest['format']): Promise<void> => {
    setOperation(null);
    try {
      const ref = await createReportApi(session.client).export(
        exportRequest('revenue-by-channel', format, filtersToParams(applied)),
      );
      setOperation(ref.data);
      await poll(ref.data.operationId);
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: '—',
          onReload: () => void load(applied),
          onLookup: () => void load(applied),
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

  const totals = report === null ? null : revenueTotals(report.rows);

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('reports.revenue.title')}</h1>
      <p style={{ margin: 0 }}>{t('reports.revenue.intro')}</p>
      <form
        data-testid="revenue-filters"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          setApplied(draft);
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
        <button type="submit">{t('reports.filters.load')}</button>
      </form>
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(applied)} />
        )}
        {operation === null ? null : <OperationPanel view={operation} />}
        {report === null ? null : (
          <>
            <RevenueByChannelTable report={report} />
            {totals === null ? null : (
              <p role="status" data-testid="revenue-total" style={{ margin: 0 }}>
                {t('reports.revenue.total')}: {formatMoney(totals.grossAmount)} ·{' '}
                {formatMoney(totals.commissionAmount)} · {formatMoney(totals.netAmount)} ·{' '}
                {totals.bookings}
              </p>
            )}
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
