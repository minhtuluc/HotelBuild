'use client';

/**
 * SCR-19 — Cơ sở (UC-PROP-01, FR-PROP-01/02): danh sách cơ sở kèm giờ nhận/trả và trần bán vượt,
 * sửa qua `PATCH /properties/{id}` với `If-Match` theo phiên bản đang hiển thị.
 * Quyền vẫn do server quyết định: giao diện chỉ phản ánh `403` (BR-RBAC-01, BR-RBAC-02).
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { PropertySummary, PropertyUpdateRequest } from '@pinehill/contracts';
import { StateSurface, formatStatusWithEnum } from '@pinehill/ui-web';
import { useForcedState } from '../../../components/forced-state';
import { t } from '../../../lib/i18n';
import { useAdmin } from '../admin-commands/use-admin';
import { AdminPanels } from '../admin-commands/panels';
import { adminText } from '../admin-commands/messages';

interface Draft {
  row: PropertySummary;
  name: string;
  status: PropertySummary['status'];
  overbookLimitPct: number;
  checkInTime: string;
  checkOutTime: string;
  reason: string;
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
  canEdit,
}: {
  canEdit: boolean;
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
                {canEdit ? (
                  <button type="button" onClick={() => onEdit(row)} style={{ minHeight: 44 }}>
                    {t('properties.edit')}
                  </button>
                ) : null}
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
  disabled,
}: {
  disabled: boolean;
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
      <fieldset
        disabled={disabled}
        style={{ display: 'grid', gap: 'var(--space-s2, 8px)', border: 0, padding: 0 }}
      >
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
        <button disabled={disabled} type="submit" style={{ minHeight: 44 }}>
          {t('properties.form.save')}
        </button>
        <button disabled={disabled} type="button" onClick={onCancel} style={{ minHeight: 44 }}>
          {t('properties.form.cancel')}
        </button>
      </div>
    </form>
  );
}

function usePropertyEditor(enabled: boolean) {
  const { controller, state } = useAdmin('property', enabled);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (
      state.phase === 'expired' ||
      state.phase === 'forbidden' ||
      (state.actorVerified && !state.canWrite)
    )
      setDraft(null);
  }, [state.phase, state.actorVerified, state.canWrite]);
  useEffect(() => {
    if (state.receipt?.kind === 'property-update') setDraft(null);
  }, [state.receipt]);
  const rows = state.data?.properties ?? [];
  const saved = state.receipt?.kind === 'property-update' ? state.receipt.data : null;
  const current = rows.find((row) => row.id === draft?.row.id);
  const submit = async () => {
    if (!draft || !controller) return;
    if (!draft.reason.trim()) {
      controller.validation([{ field: 'reason', issue: 'REQUIRED' }]);
      return;
    }
    await controller.save({
      kind: 'property-update',
      targetId: draft.row.id,
      tag: ifMatchOf(draft.row.version),
      body: changedFields(draft),
    });
  };
  const adopt = () => {
    if (!draft || !current || !state.canCompare) return;
    setDraft({ ...draft, row: { ...draft.row, version: current.version } });
    controller?.adoptVersion();
  };
  return { controller, state, draft, setDraft, rows, saved, current, submit, adopt };
}
type PropertyModel = ReturnType<typeof usePropertyEditor>;
function PropertyBody({ model }: { model: PropertyModel }): ReactElement {
  const { controller, state, draft, setDraft, rows, saved, submit } = model;
  return (
    <>
      {saved ? (
        <p role="status" data-testid="save-success" style={{ margin: 0 }}>
          {t('properties.saved', { name: saved.name, version: saved.version })}
        </p>
      ) : null}
      {rows.length ? (
        <PropertyTable
          rows={rows}
          canEdit={state.canWrite && !!controller?.canStart()}
          onEdit={(row) => {
            controller?.clearValidation();
            setDraft(draftOf(row));
          }}
        />
      ) : null}
      {state.canWrite && draft ? (
        <PropertyEditor
          draft={draft}
          disabled={state.busy || !controller?.canStart()}
          onChange={setDraft}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          onCancel={() => {
            setDraft(null);
            controller?.clearValidation();
          }}
        />
      ) : null}
    </>
  );
}
function PropertyComparison({ model }: { model: PropertyModel }): ReactElement | null {
  const { state, current, adopt } = model;
  if (state.phase !== 'conflict' || !state.canCompare || !current) return null;
  return (
    <div data-testid="admin-comparison">
      <p>{adminText('current', { version: current.version, name: current.name })}</p>
      <button type="button" disabled={state.busy} onClick={adopt} style={{ minHeight: 44 }}>
        {adminText('adopt')}
      </button>
    </div>
  );
}
export function PropertiesScreen(): ReactElement {
  const forced = useForcedState();
  const model = usePropertyEditor(forced === undefined);
  const { state, controller, draft } = model;
  if (forced !== undefined)
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  return (
    <section
      style={{
        padding: 'var(--space-s6, 24px)',
        display: 'grid',
        gap: 'var(--space-s4, 16px)',
        minWidth: 0,
      }}
    >
      <h1 style={{ margin: 0 }}>{t('properties.title')}</h1>
      <p style={{ margin: 0 }}>{t('properties.intro')}</p>
      <button
        type="button"
        disabled={state.busy}
        onClick={() => void controller?.load()}
        style={{ minHeight: 44, justifySelf: 'start' }}
      >
        {t('properties.reload')}
      </button>
      <AdminPanels
        state={state}
        controller={controller}
        version={String(draft?.row.version ?? 'mới')}
      />
      <PropertyComparison model={model} />
      <PropertyBody model={model} />
    </section>
  );
}
