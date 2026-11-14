'use client';

/**
 * SCR-55 — Báo cáo quá tải & điều chuyển (UC-REP-04, BR-OVER-15, BR-OVER-16).
 * Số ca, thời điểm phát hiện/xử lý và ba khoản chi phí xử lý đọc nguyên từ máy chủ; dòng tổng chỉ cộng.
 * Hợp đồng xuất báo cáo (`reportNameSchema`) **không** có `overbooking` nên màn này không có nút xuất.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createPropertyApi, createReportApi, isApiError } from '@pinehill/api-client';
import type { OverbookingReport, PropertySummary } from '@pinehill/contracts';
import { StateSurface, formatMoney, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../../components/screen-alert';
import { useForcedState } from '../../../../components/forced-state';
import {
  OPS_FIELD_LABEL_STYLE,
  OPS_FILTER_ROW_STYLE,
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_TABULAR_STYLE,
  OPS_TITLE_STYLE,
  opsNoticeStyle,
} from '../../../../components/editorial-styles';
import { t } from '../../../../lib/i18n';
import { defaultRange } from '../../../../lib/inventory-grid';
import { useOpsSession } from '../../../../lib/ops-session';
import { readFailureState } from '../../../../lib/screen-state';
import { OverbookingTable } from '../report-tables';
import { overbookingTotals, rangeIssue, type ReportFilters } from '../report-shared';
import { useFollowWorkingProperty } from '../../../../components/use-follow-working-property';
import { useWorkingPropertyId } from '../../../../session/staff-session';

const STATUSES = ['OPEN', 'PROPOSED', 'RESOLVED', 'ESCALATED'] as const;

const ROW_STYLE = OPS_FILTER_ROW_STYLE;
const FIELD_STYLE = OPS_FIELD_LABEL_STYLE;

type OverbookingStatus = (typeof STATUSES)[number];

function initialFilters(): ReportFilters {
  return { propertyId: '', ...defaultRange(new Date(), 7), groupBy: 'DAY' };
}

function statusOf(value: string): OverbookingStatus | '' {
  return STATUSES.find((status) => status === value) ?? '';
}

export function OverbookingReportScreen(): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  // Mở ở cơ sở đang làm việc; chọn "tất cả" trên màn vẫn được (TD-44).
  const working = useWorkingPropertyId();
  const [initial] = useState<ReportFilters>(() => ({ ...initialFilters(), propertyId: working }));
  const [draft, setDraft] = useState<ReportFilters>(initial);
  const [applied, setApplied] = useState<ReportFilters>(initial);
  useFollowWorkingProperty(working, [setDraft, setApplied]);
  const [status, setStatus] = useState<OverbookingStatus | ''>('');
  const [appliedStatus, setAppliedStatus] = useState<OverbookingStatus | ''>('');
  const [report, setReport] = useState<OverbookingReport | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const session = useOpsSession(['/reports', '/properties'], {
    onExpired: () => {
      setReport(null);
      setState({ kind: 'forbidden' });
    },
  });

  const load = useCallback(
    async (filters: ReportFilters, wanted: OverbookingStatus | ''): Promise<void> => {
      setReadError(null);
      const issue = rangeIssue(filters.from, filters.to);
      if (issue !== null) {
        setState({ kind: 'validationError', details: [issue] });
        return;
      }
      try {
        const [loaded, propertiesPage] = await Promise.all([
          createReportApi(session.client).overbooking({
            from: filters.from,
            to: filters.to,
            ...(filters.propertyId === '' ? {} : { propertyId: filters.propertyId }),
            ...(wanted === '' ? {} : { status: wanted }),
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
    void load(applied, appliedStatus);
  }, [forced, load, applied, appliedStatus]);

  if (forced !== undefined) {
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  }

  const totals = report === null ? null : overbookingTotals(report.rows);

  return (
    <section style={OPS_PAGE_STYLE}>
      <header style={OPS_HEADER_STYLE}>
        <h1 className="ph-display" style={OPS_TITLE_STYLE}>
          {t('reports.over.title')}
        </h1>
        <p style={OPS_INTRO_STYLE}>{t('reports.over.intro')}</p>
      </header>
      <form
        className="ph-card ph-filter-row"
        data-testid="overbooking-filters"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          setApplied(draft);
          setAppliedStatus(status);
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
          {t('reports.over.status')}
          <select
            name="status"
            value={status}
            onChange={(event) => setStatus(statusOf(event.target.value))}
          >
            <option value="">{t('reports.over.anyStatus')}</option>
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {t(`reports.over.${option}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="ph-btn-primary">
          {t('reports.filters.load')}
        </button>
      </form>
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(applied, appliedStatus)} />
        )}
        {report === null || totals === null ? null : (
          <>
            <p
              role="status"
              data-testid="overbooking-summary"
              style={{ ...opsNoticeStyle('info'), ...OPS_TABULAR_STYLE }}
            >
              {t('reports.over.cases', { count: totals.cases })} ·{' '}
              {t('reports.over.total', { amount: formatMoney(totals.totalCost) })}
            </p>
            <OverbookingTable report={report} />
          </>
        )}
      </StateSurface>
    </section>
  );
}
