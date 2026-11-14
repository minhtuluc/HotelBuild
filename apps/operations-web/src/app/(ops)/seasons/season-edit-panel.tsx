'use client';
/** HB-310 — khung sửa / ngừng / bật lại một mùa (SCR-27). */
import type { ReactElement } from 'react';
import { ConfigEditPanel } from '../../../components/config-edit-panel';
import { OPS_FIELD_LABEL_STYLE, OPS_TABULAR_STYLE } from '../../../components/editorial-styles';
import { t, type OperationsMessageKey } from '../../../lib/i18n';
import { seasonStatus } from '../../../lib/seasons';
import type { SeasonEditState } from './use-season-edit';
import type { SeasonEditDraft } from '../../../lib/seasons';

const FIELD_KEYS: Readonly<Record<string, OperationsMessageKey>> = {
  name: 'seasons.field.name',
  startDate: 'seasons.field.startDate',
  endDate: 'seasons.field.endDate',
  multiplier: 'seasons.field.multiplier',
  priority: 'seasons.field.priority',
  weekendSurchargeEnabled: 'seasons.field.weekendSurchargeEnabled',
  status: 'seasons.field.status',
  reason: 'seasons.field.reason',
};

function fieldLabel(field: string): string {
  const key = FIELD_KEYS[field];
  return key === undefined ? field : t(key);
}

export function SeasonEditPanel({
  edit,
  onChange,
  onSubmit,
  onCancel,
  onReload,
}: {
  edit: SeasonEditState;
  onChange: (draft: SeasonEditDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onReload: () => void;
}): ReactElement {
  const { item: season, draft } = edit;
  const set = (patch: Partial<SeasonEditDraft>) => onChange({ ...draft, ...patch });
  const common = {
    reason: draft.reason,
    onReason: (reason: string) => set({ reason }),
    issues: edit.issues,
    failure: edit.failure,
    noChange: edit.noChange,
    busy: edit.busy,
    fieldLabel,
    onSubmit,
    onCancel,
    onReload,
  };
  if (edit.mode === 'toggle') {
    const active = seasonStatus(season) === 'ACTIVE';
    return (
      <ConfigEditPanel
        testId="season-toggle"
        title={t(active ? 'seasons.toggle.offTitle' : 'seasons.toggle.onTitle', {
          name: season.name,
        })}
        note={t(active ? 'seasons.toggle.offNote' : 'seasons.toggle.onNote')}
        danger={active}
        submitLabel={t(active ? 'seasons.toggle.off' : 'seasons.toggle.on')}
        {...common}
      />
    );
  }
  return (
    <ConfigEditPanel
      testId="season-edit"
      title={t('seasons.edit.title', { name: season.name, version: season.version })}
      submitLabel={t('seasons.edit.save')}
      {...common}
    >
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('seasons.field.name')}
        <input name="name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('seasons.field.startDate')}
        <input
          name="startDate"
          type="date"
          value={draft.startDate}
          onChange={(e) => set({ startDate: e.target.value })}
        />
      </label>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('seasons.field.endDate')}
        <input
          name="endDate"
          type="date"
          value={draft.endDate}
          onChange={(e) => set({ endDate: e.target.value })}
        />
      </label>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('seasons.field.multiplier')}
        <input
          name="multiplier"
          inputMode="decimal"
          style={OPS_TABULAR_STYLE}
          value={draft.multiplier}
          onChange={(e) => set({ multiplier: e.target.value })}
        />
      </label>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('seasons.field.priority')}
        <input
          name="priority"
          inputMode="numeric"
          style={OPS_TABULAR_STYLE}
          value={draft.priority}
          onChange={(e) => set({ priority: e.target.value })}
        />
      </label>
      <label className="ph-check">
        <input
          type="checkbox"
          name="weekendSurchargeEnabled"
          checked={draft.weekendSurchargeEnabled}
          onChange={(e) => set({ weekendSurchargeEnabled: e.target.checked })}
        />
        {t('seasons.field.weekendSurchargeEnabled')}
      </label>
    </ConfigEditPanel>
  );
}
