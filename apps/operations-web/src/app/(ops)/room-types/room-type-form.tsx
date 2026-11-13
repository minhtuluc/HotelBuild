'use client';

/** Biểu mẫu tạo loại phòng SCR-20 (UC-PROP-02) — cảnh báo sàn–trần chỉ mang tính nhắc, server vẫn chặn. */
import type { FormEvent, ReactElement } from 'react';
import type { PropertySummary } from '@pinehill/contracts';
import { color, space } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_SUBTITLE_STYLE,
  OPS_TABULAR_STYLE,
  opsNoticeStyle,
} from '../../../components/editorial-styles';
import { roomTypePriceWarnings, type RoomTypePriceWarning } from '../../../lib/room-type-warnings';
import { toMoney } from '../../../lib/money';
import { t, type OperationsMessageKey } from '../../../lib/i18n';
import type { RoomTypeDraft } from './room-type-draft';

const WARNING_MESSAGES: Readonly<Record<RoomTypePriceWarning, OperationsMessageKey>> = {
  floorAboveCeiling: 'roomTypes.warn.floorAboveCeiling',
  baseBelowFloor: 'roomTypes.warn.baseBelowFloor',
  baseAboveCeiling: 'roomTypes.warn.baseAboveCeiling',
};

function priceWarnings(draft: RoomTypeDraft): readonly RoomTypePriceWarning[] {
  const basePrice = toMoney(draft.basePrice);
  const minPrice = toMoney(draft.minPrice);
  const maxPrice = toMoney(draft.maxPrice);
  if (basePrice === null || minPrice === null || maxPrice === null) return [];
  return roomTypePriceWarnings({ basePrice, minPrice, maxPrice });
}

export function RoomTypeForm({
  draft,
  properties,
  onChange,
  onSubmit,
  onCancel,
  disabled,
}: {
  disabled: boolean;
  draft: RoomTypeDraft;
  properties: readonly PropertySummary[];
  onChange: (next: RoomTypeDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}): ReactElement {
  const field = (
    label: string,
    value: string,
    update: (value: string) => void,
    type = 'text',
  ): ReactElement => (
    <label style={OPS_FIELD_LABEL_STYLE}>
      {label}
      <input
        type={type}
        value={value}
        style={type === 'number' ? OPS_TABULAR_STYLE : undefined}
        onChange={(event) => update(event.target.value)}
      />
    </label>
  );
  const warnings = priceWarnings(draft);
  return (
    <form
      data-testid="room-type-form"
      onSubmit={onSubmit}
      className="ph-card"
      style={{ display: 'grid', gap: space.s4, maxWidth: 520, minWidth: 0 }}
    >
      <fieldset
        disabled={disabled}
        style={{ display: 'grid', gap: space.s3, border: 0, padding: 0, margin: 0 }}
      >
        <legend style={{ ...OPS_SUBTITLE_STYLE, marginBottom: space.s1 }}>
          {t('roomTypes.form.legend')}
        </legend>
        <label style={OPS_FIELD_LABEL_STYLE}>
          {t('roomTypes.form.property')}
          <select
            value={draft.propertyId}
            onChange={(event) => onChange({ ...draft, propertyId: event.target.value })}
          >
            <option value="">—</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
        {field(t('roomTypes.form.code'), draft.code, (value) =>
          onChange({ ...draft, code: value }),
        )}
        {field(
          t('roomTypes.form.capacityAdults'),
          draft.capacityAdults,
          (value) => onChange({ ...draft, capacityAdults: value }),
          'number',
        )}
        {field(
          t('roomTypes.form.capacityChildren'),
          draft.capacityChildren,
          (value) => onChange({ ...draft, capacityChildren: value }),
          'number',
        )}
        {field(
          t('roomTypes.form.basePrice'),
          draft.basePrice,
          (value) => onChange({ ...draft, basePrice: value }),
          'number',
        )}
        {field(
          t('roomTypes.form.minPrice'),
          draft.minPrice,
          (value) => onChange({ ...draft, minPrice: value }),
          'number',
        )}
        {field(
          t('roomTypes.form.maxPrice'),
          draft.maxPrice,
          (value) => onChange({ ...draft, maxPrice: value }),
          'number',
        )}
        {field(
          t('roomTypes.form.bedCount'),
          draft.bedCount,
          (value) => onChange({ ...draft, bedCount: value }),
          'number',
        )}
        <label
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            minHeight: 44,
            fontSize: 14,
            color: color.text,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={draft.allowShared}
            onChange={(event) => onChange({ ...draft, allowShared: event.target.checked })}
          />
          {t('roomTypes.form.allowShared')}
        </label>
      </fieldset>
      <ul
        data-testid="room-type-warnings"
        style={
          warnings.length
            ? { ...opsNoticeStyle('warning'), paddingInlineStart: 32, margin: 0 }
            : { margin: 0, paddingInlineStart: 20 }
        }
      >
        {warnings.map((warning) => (
          <li key={warning}>{t(WARNING_MESSAGES[warning])}</li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: space.s2, flexWrap: 'wrap' }}>
        <button
          disabled={disabled}
          type="submit"
          className="ph-btn-primary"
          style={OPS_COMPACT_BTN_STYLE}
        >
          {t('roomTypes.form.submit')}
        </button>
        <button
          disabled={disabled}
          type="button"
          onClick={onCancel}
          className="ph-btn"
          style={OPS_COMPACT_BTN_STYLE}
        >
          {t('roomTypes.form.cancel')}
        </button>
      </div>
    </form>
  );
}
