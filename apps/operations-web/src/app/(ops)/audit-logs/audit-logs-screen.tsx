'use client';

/**
 * SCR-16 — Nhật ký kiểm toán (UC-SYS-01, BR-SYS-01/05, BR-RBAC-02): bảng **chỉ đọc** có lọc theo
 * người thao tác/đối tượng/hành động/khoảng thời gian, phân trang con trỏ và xuất CSV đúng các dòng
 * đang xem. Không có bất kỳ thao tác tạo/sửa/xoá nào kể cả trên giao diện.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';
import type { AuditLogEntry } from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_FILTER_ROW_STYLE,
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_TITLE_STYLE,
  opsNoticeStyle,
} from '../../../components/editorial-styles';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { t } from '../../../lib/i18n';
import {
  EMPTY_AUDIT_FILTERS,
  auditCsvFileName,
  toCsv,
  type AuditFilters,
} from '../../../lib/audit-log';
import { useAudit } from './use-audit';
import { auditText } from './messages-transport';
import { AuditLogTable } from './audit-log-table';

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
    <label style={OPS_FIELD_LABEL_STYLE}>
      {t(key)}
      {type === 'datetime-local' ? ' (' + auditText('vnTime') + ')' : null}
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
      className="ph-card ph-filter-row"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onApply();
      }}
      style={OPS_FILTER_ROW_STYLE}
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
      <button type="submit" className="ph-btn-primary" style={OPS_COMPACT_BTN_STYLE}>
        {t('audit.filter.apply')}
      </button>
      <button type="button" className="ph-btn" onClick={onClear} style={OPS_COMPACT_BTN_STYLE}>
        {t('audit.filter.clear')}
      </button>
    </form>
  );
}

export function AuditLogsScreen(): ReactElement {
  const forced = useForcedState();
  // Lọc sẵn từ URL (`?entityType=SystemSetting&entityId=…`) để SCR-17 mở lịch sử của một tham số.
  const searchParams = useSearchParams();
  const fromUrl = (): AuditFilters => ({
    ...EMPTY_AUDIT_FILTERS,
    actorId: searchParams.get('actorId') ?? '',
    entityType: searchParams.get('entityType') ?? '',
    entityId: searchParams.get('entityId') ?? '',
    action: searchParams.get('action') ?? '',
  });
  const [draft, setDraft] = useState<AuditFilters>(fromUrl);
  const [filters, setFilters] = useState<AuditFilters>(fromUrl);
  const workspace = useAudit(filters, forced === undefined);
  const { rows, nextCursor, loadingMore } = workspace.state;
  const readError = workspace.state.error;
  const state = surfaceState(workspace.state);
  const load = () => workspace.controller?.load(filters);
  const loadMore = () => workspace.controller?.loadMore();

  if (forced !== undefined) {
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  }

  return (
    <section style={OPS_PAGE_STYLE}>
      <header style={OPS_HEADER_STYLE}>
        <h1 style={OPS_TITLE_STYLE}>{t('audit.title')}</h1>
        <p style={OPS_INTRO_STYLE}>{t('audit.intro')}</p>
      </header>
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
          className="ph-btn"
          data-testid="audit-reload"
          onClick={() => {
            void load();
          }}
          style={OPS_COMPACT_BTN_STYLE}
        >
          {t('audit.reload')}
        </button>
        <button
          type="button"
          className="ph-btn"
          data-testid="audit-export"
          onClick={() => {
            downloadCsv(rows);
          }}
          disabled={rows.length === 0}
          style={OPS_COMPACT_BTN_STYLE}
        >
          {t('audit.export')}
        </button>
      </div>
      {workspace.state.phase === 'expired' ? (
        <p role="alert" style={opsNoticeStyle('danger')}>
          {auditText('expired')} <a href="/login">{auditText('login')}</a>
        </p>
      ) : null}
      <StateSurface state={state}>
        {readError === null ? null : <ScreenAlert error={readError} onRetry={() => void load()} />}
        {rows.length === 0 ? null : (
          <>
            <p role="status" data-testid="audit-count" style={{ margin: 0, fontSize: 13 }}>
              {t('audit.updated', { count: rows.length })}
            </p>
            <AuditLogTable rows={rows} />
            {nextCursor === null ? null : (
              <button
                type="button"
                className="ph-btn"
                data-testid="audit-more"
                onClick={() => void loadMore()}
                disabled={loadingMore || workspace.state.phase !== 'ready'}
                style={{ ...OPS_COMPACT_BTN_STYLE, justifySelf: 'start' }}
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

function surfaceState(state: import('./controller').AuditState): ScreenState {
  switch (state.phase) {
    case 'loading':
      return { kind: 'loading' };
    case 'refreshing':
      return {
        kind: 'refreshing',
        updatedAt: state.updatedAt ?? new Date().toISOString(),
        stale: true,
      };
    case 'empty':
      return {
        kind: 'empty',
        reason: Object.values(state.filters).some(Boolean) ? 'filtered' : 'noData',
        canCreate: false,
      };
    case 'expired':
    case 'forbidden':
      return { kind: 'forbidden' };
    case 'validation':
      return {
        kind: 'validationError',
        details: [{ field: 'from/to', issue: auditText('invalid') }],
      };
    default:
      return { kind: 'ready' };
  }
}
