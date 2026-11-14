'use client';
/**
 * HB-311 (TD-08) — sửa / tắt sớm / bật lại khuyến mãi (SCR-29) qua `PUT /promotions/{id}`: `If-Match`
 * của bản đang xem, chỉ trường đổi, lý do bắt buộc. `code` và `type` không đổi được.
 */
import type { ReactElement } from 'react';
import { createRateApi, type ApiClient } from '@pinehill/api-client';
import type { PromotionSummary, RoomTypeSummary } from '@pinehill/contracts';
import { ConfigEditPanel } from '../../../components/config-edit-panel';
import { OPS_FIELD_LABEL_STYLE, OPS_TABULAR_STYLE } from '../../../components/editorial-styles';
import { useConfigEdit, type ConfigEditState } from '../../../components/use-config-edit';
import { ifMatchOf } from '../../../lib/config-edit';
import { t, type OperationsMessageKey } from '../../../lib/i18n';
import {
  CHANNEL_CODES,
  promotionEditDraftOf,
  toPromotionToggle,
  toPromotionUpdate,
  toggle,
  validatePromotionEdit,
  valueUnitKey,
  type PromotionEditDraft,
} from '../../../lib/promotions';

export type PromotionEditState = ConfigEditState<PromotionSummary, PromotionEditDraft>;

export function usePromotionEdit(client: ApiClient, onSaved: (code: string) => Promise<void>) {
  return useConfigEdit({
    draftOf: promotionEditDraftOf,
    validate: validatePromotionEdit,
    toUpdate: toPromotionUpdate,
    toToggle: toPromotionToggle,
    send: (promotion, body) =>
      createRateApi(client).updatePromotion(promotion.id, body, ifMatchOf(promotion.version)),
    onSaved: (promotion) => onSaved(promotion.code),
  });
}

const FIELD_KEYS: Readonly<Record<string, OperationsMessageKey>> = {
  value: 'promotions.field.value',
  minNights: 'promotions.field.minNights',
  maxUses: 'promotions.field.maxUses',
  validFrom: 'promotions.field.validFrom',
  validTo: 'promotions.field.validTo',
  channelScope: 'promotions.field.channelScope',
  roomTypeScope: 'promotions.field.roomTypeScope',
  stackable: 'promotions.field.stackable',
  status: 'promotions.field.status',
  reason: 'promotions.field.reason',
};

function fieldLabel(field: string): string {
  const key = FIELD_KEYS[field];
  return key === undefined ? field : t(key);
}

export function PromotionEditPanel({
  edit,
  roomTypes,
  onChange,
  onSubmit,
  onCancel,
  onReload,
}: {
  edit: PromotionEditState;
  roomTypes: readonly RoomTypeSummary[];
  onChange: (draft: PromotionEditDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onReload: () => void;
}): ReactElement {
  const { item: promotion, draft } = edit;
  const set = (patch: Partial<PromotionEditDraft>) => onChange({ ...draft, ...patch });
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
    const active = promotion.status === 'ACTIVE';
    return (
      <ConfigEditPanel
        testId="promotion-toggle"
        title={t(active ? 'promotions.toggle.offTitle' : 'promotions.toggle.onTitle', {
          code: promotion.code,
        })}
        note={
          active
            ? t('promotions.toggle.offNote', { used: promotion.usedCount })
            : t('promotions.toggle.onNote')
        }
        danger={active}
        submitLabel={t(active ? 'promotions.toggle.off' : 'promotions.toggle.on')}
        {...common}
      />
    );
  }
  return (
    <ConfigEditPanel
      testId="promotion-edit"
      title={t('promotions.edit.title', { code: promotion.code, version: promotion.version })}
      note={t('promotions.edit.fixed')}
      submitLabel={t('promotions.edit.save')}
      {...common}
    >
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t(valueUnitKey(promotion.type))}
        <input
          name="value"
          inputMode="numeric"
          style={OPS_TABULAR_STYLE}
          value={draft.value}
          onChange={(e) => set({ value: e.target.value })}
        />
      </label>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('promotions.field.minNights')}
        <input
          name="minNights"
          inputMode="numeric"
          style={OPS_TABULAR_STYLE}
          value={draft.minNights}
          onChange={(e) => set({ minNights: e.target.value })}
        />
      </label>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('promotions.field.maxUses')}
        <input
          name="maxUses"
          inputMode="numeric"
          placeholder={t('promotions.form.maxUsesHelp')}
          style={OPS_TABULAR_STYLE}
          value={draft.maxUses}
          onChange={(e) => set({ maxUses: e.target.value })}
        />
      </label>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('promotions.field.validFrom')}
        <input
          name="validFrom"
          type="datetime-local"
          value={draft.validFrom}
          onChange={(e) => set({ validFrom: e.target.value })}
        />
      </label>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('promotions.field.validTo')}
        <input
          name="validTo"
          type="datetime-local"
          value={draft.validTo}
          onChange={(e) => set({ validTo: e.target.value })}
        />
      </label>
      <label className="ph-check">
        <input
          type="checkbox"
          name="stackable"
          checked={draft.stackable}
          onChange={(e) => set({ stackable: e.target.checked })}
        />
        {t('promotions.field.stackable')}
      </label>
      <fieldset className="ph-check-group">
        <legend>{t('promotions.field.channelScope')}</legend>
        {CHANNEL_CODES.map((code) => (
          <label key={code} className="ph-check">
            <input
              type="checkbox"
              checked={draft.channelScope.includes(code)}
              onChange={() => set({ channelScope: toggle(draft.channelScope, code) })}
            />
            {t(`enum.channelCode.${code}`)}
          </label>
        ))}
      </fieldset>
      <fieldset className="ph-check-group">
        <legend>{t('promotions.field.roomTypeScope')}</legend>
        {roomTypes.map((type) => (
          <label key={type.id} className="ph-check">
            <input
              type="checkbox"
              checked={draft.roomTypeScope.includes(type.id)}
              onChange={() => set({ roomTypeScope: toggle(draft.roomTypeScope, type.id) })}
            />
            {type.code}
          </label>
        ))}
      </fieldset>
    </ConfigEditPanel>
  );
}
