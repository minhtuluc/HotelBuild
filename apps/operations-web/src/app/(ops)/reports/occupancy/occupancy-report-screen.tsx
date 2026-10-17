'use client';

/**
 * SCR-52 — Báo cáo công suất và ADR/RevPAR (UC-REP-01, BR-REP-01, BR-RATE-08, BR-PROP-03).
 * Hai bảng đọc từ máy chủ theo cùng bộ lọc kỳ/cơ sở/cách gộp; giao diện **không** tính lại chỉ số mà
 * chỉ hiện công thức cùng tử số–mẫu số máy chủ trả. Xuất CSV/XLSX là tác vụ bất đồng bộ `202` +
 * theo dõi `operationId` (NFR-COMP-04).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  createPropertyApi,
  createReportApi,
  createSystemApi,
  isApiError,
  type ApiClient,
} from '@pinehill/api-client';
import type {
  AdrRevparReport,
  OccupancyReport,
  OperationStatusView,
  PropertySummary,
  ReportExportRequest,
} from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../../components/screen-alert';
import { useForcedState } from '../../../../components/forced-state';
import { t } from '../../../../lib/i18n';
import { defaultRange } from '../../../../lib/inventory-grid';
import { useOpsSession } from '../../../../lib/ops-session';
import { readFailureState, writeFailureState } from '../../../../lib/screen-state';
import { AdrRevparTable, OccupancyTable, OperationPanel } from '../report-tables';
import {
  exportRequest,
  filtersToParams,
  isTerminal,
  rangeIssue,
  type ReportFilters,
} from '../report-shared';

const POLL_INTERVAL_MS = 1_000;
const POLL_MAX_ATTEMPTS = 30;
const GROUP_BY = ['DAY', 'ROOM_TYPE', 'PROPERTY'] as const;

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

function groupByOf(value: string): ReportFilters['groupBy'] {
  return GROUP_BY.find((option) => option === value) ?? 'DAY';
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

interface Reports {
  occupancy: OccupancyReport;
  adrRevpar: AdrRevparReport;
}

async function fetchReports(client: ApiClient, filters: ReportFilters): Promise<Reports> {
  const api = createReportApi(client);
  const query = {
    from: filters.from,
    to: filters.to,
    groupBy: filters.groupBy,
    ...(filters.propertyId === '' ? {} : { propertyId: filters.propertyId }),
  };
  const [occupancy, adrRevpar] = await Promise.all([api.occupancy(query), api.adrRevpar(query)]);
  return { occupancy: occupancy.data, adrRevpar: adrRevpar.data };
}

export function OccupancyReportScreen(): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [initial] = useState<ReportFilters>(initialFilters);
  const [draft, setDraft] = useState<ReportFilters>(initial);
  const [applied, setApplied] = useState<ReportFilters>(initial);
  const [reports, setReports] = useState<Reports | null>(null);
  const [operation, setOperation] = useState<OperationStatusView | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const canExport = state.kind !== 'forbidden';
  const session = useOpsSession(['/reports', '/properties', '/operations'], {
    onExpired: () => {
      setReports(null);
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
        const [loaded, propertiesPage] = await Promise.all([
          fetchReports(session.client, filters),
          createPropertyApi(session.client).list(),
        ]);
        setProperties(propertiesPage.data.data);
        setReports(loaded);
        setState(
          loaded.occupancy.rows.length === 0
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

  const runExport = async (
    report: ReportExportRequest['report'],
    format: ReportExportRequest['format'],
  ): Promise<void> => {
    setOperation(null);
    try {
      const ref = await createReportApi(session.client).export(
        exportRequest(report, format, filtersToParams(applied)),
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

  const exportButtons = (report: ReportExportRequest['report']): ReactElement | null =>
    canExport ? (
      <div style={ROW_STYLE}>
        <button type="button" onClick={() => void runExport(report, 'CSV')}>
          {t('reports.export.csv')}
        </button>
        <button type="button" onClick={() => void runExport(report, 'XLSX')}>
          {t('reports.export.xlsx')}
        </button>
      </div>
    ) : null;

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('reports.occupancy.title')}</h1>
      <p style={{ margin: 0 }}>{t('reports.occupancy.intro')}</p>
      <form
        data-testid="occupancy-filters"
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
        <label style={FIELD_STYLE}>
          {t('reports.filters.groupBy')}
          <select
            name="groupBy"
            value={draft.groupBy}
            onChange={(event) => setDraft({ ...draft, groupBy: groupByOf(event.target.value) })}
          >
            {GROUP_BY.map((option) => (
              <option key={option} value={option}>
                {t(`reports.groupBy.${option}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">{t('reports.filters.load')}</button>
      </form>
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(applied)} />
        )}
        {operation === null ? null : <OperationPanel view={operation} />}
        {reports === null ? null : (
          <>
            <OccupancyTable report={reports.occupancy} />
            {exportButtons('occupancy')}
            <AdrRevparTable report={reports.adrRevpar} />
            {exportButtons('adr-revpar')}
          </>
        )}
      </StateSurface>
    </section>
  );
}
