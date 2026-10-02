'use client';

/**
 * SCR-19 — Cơ sở (UC-PROP-01, FR-PROP-01/02): danh sách cơ sở kèm giờ nhận/trả và trần bán vượt,
 * sửa qua `PATCH /properties/{id}` với `If-Match` theo phiên bản đang hiển thị.
 * Quyền vẫn do server quyết định: giao diện chỉ phản ánh `403` (BR-RBAC-01, BR-RBAC-02).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createPropertyApi, isApiError } from '@pinehill/api-client';
import type { PropertySummary, PropertyUpdateRequest } from '@pinehill/contracts';
import { StateSurface, formatStatusWithEnum, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';

interface Draft {
  row: PropertySummary;
  name: string;
  status: PropertySummary['status'];
  overbookLimitPct: number;
  checkInTime: string;
  checkOutTime: string;
  reason: string;
}

interface Saved {
  name: string;
  version: number;
}

function draftOf(row: PropertySummary): Draft {
  return {
    row,
    name: row.name,
    status: row.status,
    overbookLimitPct: row.overbookLimitPct,
    checkInTime: row.checkInTime,
    checkOutTime: row.checkOutTime,
    reason: '',
  };
}

/** Chỉ gửi trường thực sự đổi — PATCH giữ nguyên phần còn lại; `reason` luôn kèm (BR-SYS-05). */
function changedFields(draft: Draft): PropertyUpdateRequest {
  const input: PropertyUpdateRequest = { reason: draft.reason };
  if (draft.name !== draft.row.name) input.name = draft.name;
  if (draft.status !== draft.row.status) input.status = draft.status;
  if (draft.overbookLimitPct !== draft.row.overbookLimitPct) {
    input.overbookLimitPct = draft.overbookLimitPct;
  }
  if (draft.checkInTime !== draft.row.checkInTime) input.checkInTime = draft.checkInTime;
  if (draft.checkOutTime !== draft.row.checkOutTime) input.checkOutTime = draft.checkOutTime;
  return input;
}

/** ETag là phiên bản số có dấu ngoặc kép, ví dụ `"7"` (api.md §1.3). */
function ifMatchOf(version: number): string {
  return `"${version}"`;
}

function PropertyTable({
  rows,
  onEdit,
}: {
  rows: readonly PropertySummary[];
  onEdit: (row: PropertySummary) => void;
}): ReactElement {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="properties-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
          {t('properties.title')}
        </caption>
        <thead>
          <tr>
            {[
              t('properties.col.name'),
              t('properties.col.status'),
              t('properties.col.rooms'),
              t('properties.col.overbook'),
              t('properties.col.checkInOut'),
              t('properties.col.version'),
              t('properties.col.actions'),
            ].map((label) => (
              <th
                key={label}
                scope="col"
                style={{ textAlign: 'start', borderBottom: '1px solid var(--color-border)' }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{formatStatusWithEnum(t(`enum.propertyStatus.${row.status}`), row.status)}</td>
              <td>{row.activeRoomCount}</td>
              <td>{row.overbookLimitPct}</td>
              <td>
                {row.checkInTime} / {row.checkOutTime}
              </td>
              <td>{row.version}</td>
              <td>
                <button type="button" onClick={() => onEdit(row)} style={{ minHeight: 44 }}>
                  {t('properties.edit')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PropertyEditor({
  draft,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}): ReactElement {
  const text = (
    label: string,
    value: string,
    update: (value: string) => void,
    type = 'text',
  ): ReactElement => (
    <label style={{ display: 'grid', gap: 4 }}>
      {label}
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
      data-testid="property-editor"
      onSubmit={onSubmit}
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)', maxWidth: 420 }}
    >
      <fieldset style={{ display: 'grid', gap: 'var(--space-s2, 8px)', border: 0, padding: 0 }}>
        <legend>
          {t('properties.form.legend', { name: draft.row.name, version: draft.row.version })}
        </legend>
        {text(t('properties.form.name'), draft.name, (value) =>
          onChange({ ...draft, name: value }),
        )}
        <label style={{ display: 'grid', gap: 4 }}>
          {t('properties.form.overbook')}
          <input
            type="number"
            min={0}
            max={100}
            value={draft.overbookLimitPct}
            onChange={(event) =>
              onChange({ ...draft, overbookLimitPct: Number(event.target.value) })
            }
          />
        </label>
        {text(
          t('properties.form.checkIn'),
          draft.checkInTime,
          (value) => onChange({ ...draft, checkInTime: value }),
          'time',
        )}
        {text(
          t('properties.form.checkOut'),
          draft.checkOutTime,
          (value) => onChange({ ...draft, checkOutTime: value }),
          'time',
        )}
        <label style={{ display: 'grid', gap: 4 }}>
          {t('properties.form.status')}
          <select
            value={draft.status}
            onChange={(event) =>
              onChange({
                ...draft,
                status: event.target.value === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
              })
            }
          >
            <option value="ACTIVE">{t('enum.propertyStatus.ACTIVE')}</option>
            <option value="INACTIVE">{t('enum.propertyStatus.INACTIVE')}</option>
          </select>
        </label>
        {text(t('properties.form.reason'), draft.reason, (value) =>
          onChange({ ...draft, reason: value }),
        )}
      </fieldset>
      <div style={{ display: 'flex', gap: 'var(--space-s2, 8px)' }}>
        <button type="submit" style={{ minHeight: 44 }}>
          {t('properties.form.save')}
        </button>
        <button type="button" onClick={onCancel} style={{ minHeight: 44 }}>
          {t('properties.form.cancel')}
        </button>
      </div>
    </form>
  );
}

export function PropertiesScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [rows, setRows] = useState<readonly PropertySummary[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [readError, setReadError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    setReadError(null);
    try {
      const page = await createPropertyApi(opsApiClient(baseUrl)).list();
      setRows(page.data.data);
      setState(
        page.data.data.length === 0
          ? { kind: 'empty', reason: 'noData', canCreate: false }
          : { kind: 'ready' },
      );
    } catch (caught) {
      const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
      if (mapped !== undefined) {
        setState(mapped);
        return;
      }
      // Giữ nguyên nội dung đã có; băng lỗi nói rõ chưa đọc được thay vì hiện "chưa có dữ liệu".
      setReadError(caught);
      setState({ kind: 'ready' });
    }
  }, [baseUrl]);

  useEffect(() => {
    if (forced !== undefined) return;
    void load();
  }, [forced, load]);

  const submit = async (): Promise<void> => {
    if (draft === null) return;
    if (draft.reason.trim() === '') {
      setState({ kind: 'validationError', details: [{ field: 'reason', issue: 'REQUIRED' }] });
      return;
    }
    const version = draft.row.version;
    try {
      const updated = await createPropertyApi(opsApiClient(baseUrl)).update(
        draft.row.id,
        changedFields(draft),
        ifMatchOf(version),
      );
      setRows((current) => current.map((row) => (row.id === updated.data.id ? updated.data : row)));
      setSaved({ name: updated.data.name, version: updated.data.version });
      setDraft(null);
      setState({ kind: 'ready' });
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: String(version),
          onReload: () => void load(),
          onLookup: () => void load(),
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

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('properties.title')}</h1>
      <p style={{ margin: 0 }}>{t('properties.intro')}</p>
      <button
        type="button"
        onClick={() => {
          // Mốc "cập nhật lúc" chỉ để hiển thị ở giao diện, không phải thời gian nghiệp vụ.
          setState({ kind: 'refreshing', updatedAt: new Date().toISOString(), stale: false });
          void load();
        }}
        style={{ minHeight: 44, justifySelf: 'start' }}
      >
        {t('properties.reload')}
      </button>
      <StateSurface state={state}>
        {saved === null ? null : (
          <p role="status" data-testid="save-success" style={{ margin: 0 }}>
            {t('properties.saved', { name: saved.name, version: saved.version })}
          </p>
        )}
        {readError === null ? null : <ScreenAlert error={readError} onRetry={() => void load()} />}
        {rows.length === 0 ? null : (
          <PropertyTable rows={rows} onEdit={(row) => setDraft(draftOf(row))} />
        )}
        {draft === null ? null : (
          <PropertyEditor
            draft={draft}
            onChange={setDraft}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            onCancel={() => setDraft(null)}
          />
        )}
      </StateSurface>
    </section>
  );
}
