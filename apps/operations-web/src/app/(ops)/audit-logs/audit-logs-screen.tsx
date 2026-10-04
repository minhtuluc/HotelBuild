'use client';

/**
 * SCR-16 — Nhật ký kiểm toán (UC-SYS-01, BR-SYS-01/05, BR-RBAC-02): bảng **chỉ đọc** có lọc theo
 * người thao tác/đối tượng/hành động/khoảng thời gian, phân trang con trỏ và xuất CSV đúng các dòng
 * đang xem. Không có bất kỳ thao tác tạo/sửa/xoá nào kể cả trên giao diện.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createSystemApi, isApiError } from '@pinehill/api-client';
import type { AuditLogEntry, ListPage } from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import {
  AUDIT_PAGE_SIZE,
  EMPTY_AUDIT_FILTERS,
  auditCsvFileName,
  buildAuditQuery,
  mergeAuditRows,
  toCsv,
  type AuditFilters,
} from '../../../lib/audit-log';
import { readFailureState } from '../../../lib/screen-state';
import { AuditLogTable } from './audit-log-table';

async function fetchPage(
  baseUrl: string,
  filters: AuditFilters,
  cursor?: string,
): Promise<ListPage<AuditLogEntry>> {
  const api = createSystemApi(opsApiClient(baseUrl));
  const page = await api.listAuditLogs(buildAuditQuery(filters, AUDIT_PAGE_SIZE, cursor));
  return page.data;
}

/** Xuất CSV từ **các dòng đang hiển thị** (không gọi lại máy chủ), RFC 4180 + BOM UTF-8. */
function downloadCsv(rows: readonly AuditLogEntry[]): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = auditCsvFileName();
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function FilterForm({
  draft,
  onChange,
  onApply,
  onClear,
}: {
  draft: AuditFilters;
  onChange: (next: AuditFilters) => void;
  onApply: () => void;
  onClear: () => void;
}): ReactElement {
  const text = (
    key: Parameters<typeof t>[0],
    value: string,
    update: (next: string) => void,
    type = 'text',
  ): ReactElement => (
    <label style={{ display: 'grid', gap: 4 }}>
      {t(key)}
      <input
        type={type}
        value={value}
        onChange={(event) => {
          update(event.target.value);
        }}
      />
    </label>
  );
  return (
    <form
      data-testid="audit-filters"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onApply();
      }}
      style={{ display: 'flex', gap: 'var(--space-s2, 8px)', flexWrap: 'wrap', alignItems: 'end' }}
    >
      {text('audit.filter.actor', draft.actorId, (value) => onChange({ ...draft, actorId: value }))}
      {text('audit.filter.entityType', draft.entityType, (value) =>
        onChange({ ...draft, entityType: value }),
      )}
      {text('audit.filter.entityId', draft.entityId, (value) =>
        onChange({ ...draft, entityId: value }),
      )}
      {text('audit.filter.action', draft.action, (value) => onChange({ ...draft, action: value }))}
      {text(
        'audit.filter.from',
        draft.from,
        (value) => onChange({ ...draft, from: value }),
        'datetime-local',
      )}
      {text(
        'audit.filter.to',
        draft.to,
        (value) => onChange({ ...draft, to: value }),
        'datetime-local',
      )}
      <button type="submit" style={{ minHeight: 44 }}>
        {t('audit.filter.apply')}
      </button>
      <button type="button" onClick={onClear} style={{ minHeight: 44 }}>
        {t('audit.filter.clear')}
      </button>
    </form>
  );
}

export function AuditLogsScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [rows, setRows] = useState<readonly AuditLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [readError, setReadError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (target: AuditFilters): Promise<void> => {
      setReadError(null);
      try {
        const page = await fetchPage(baseUrl, target);
        setRows(page.data);
        setNextCursor(page.meta.nextCursor);
        setState(
          page.data.length === 0
            ? {
                kind: 'empty',
                reason: Object.values(target).some((value) => value !== '') ? 'filtered' : 'noData',
                canCreate: false,
              }
            : { kind: 'ready' },
        );
      } catch (caught) {
        const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
        if (mapped !== undefined) {
          setState(mapped);
          return;
        }
        // Giữ nguyên bảng đã có; băng lỗi nói rõ chưa đọc được thay vì hiện "chưa có dữ liệu".
        setReadError(caught);
        setState({ kind: 'ready' });
      }
    },
    [baseUrl],
  );

  useEffect(() => {
    if (forced !== undefined) return;
    void load(filters);
  }, [forced, load, filters]);

  const loadMore = async (): Promise<void> => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(baseUrl, filters, nextCursor);
      setRows((current) => mergeAuditRows(current, page.data));
      setNextCursor(page.meta.nextCursor);
    } catch (caught) {
      setReadError(caught);
    } finally {
      setLoadingMore(false);
    }
  };

  if (forced !== undefined) {
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  }

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('audit.title')}</h1>
      <p style={{ margin: 0 }}>{t('audit.intro')}</p>
      <FilterForm
        draft={draft}
        onChange={setDraft}
        onApply={() => {
          setFilters(draft);
        }}
        onClear={() => {
          setDraft(EMPTY_AUDIT_FILTERS);
          setFilters(EMPTY_AUDIT_FILTERS);
        }}
      />
      <div style={{ display: 'flex', gap: 'var(--space-s2, 8px)', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="audit-reload"
          onClick={() => {
            void load(filters);
          }}
          style={{ minHeight: 44 }}
        >
          {t('audit.reload')}
        </button>
        <button
          type="button"
          data-testid="audit-export"
          onClick={() => {
            downloadCsv(rows);
          }}
          disabled={rows.length === 0}
          style={{ minHeight: 44 }}
        >
          {t('audit.export')}
        </button>
      </div>
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(filters)} />
        )}
        {rows.length === 0 ? null : (
          <>
            <p role="status" data-testid="audit-count" style={{ margin: 0 }}>
              {t('audit.updated', { count: rows.length })}
            </p>
            <AuditLogTable rows={rows} />
            {nextCursor === null ? null : (
              <button
                type="button"
                data-testid="audit-more"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                style={{ minHeight: 44, justifySelf: 'start' }}
              >
                {t('audit.more')}
              </button>
            )}
          </>
        )}
      </StateSurface>
    </section>
  );
}
