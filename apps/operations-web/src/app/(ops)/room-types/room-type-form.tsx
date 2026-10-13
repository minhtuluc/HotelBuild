'use client';

/** Biểu mẫu tạo loại phòng SCR-20 (UC-PROP-02) — cảnh báo sàn–trần chỉ mang tính nhắc, server vẫn chặn. */
import type { FormEvent, ReactElement } from 'react';
import type { PropertySummary } from '@pinehill/contracts';
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
    <label style={{ display: 'grid', gap: 4 }}>
      {label}
      <input type={type} value={value} onChange={(event) => update(event.target.value)} />
    </label>
  );
  return (
    <form
      data-testid="room-type-form"
      onSubmit={onSubmit}
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)', maxWidth: 420 }}
    >
      <fieldset
        disabled={disabled}
        style={{ display: 'grid', gap: 'var(--space-s2, 8px)', border: 0, padding: 0 }}
      >
        <legend>{t('roomTypes.form.legend')}</legend>
        <label style={{ display: 'grid', gap: 4 }}>
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
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={draft.allowShared}
            onChange={(event) => onChange({ ...draft, allowShared: event.target.checked })}
          />
          {t('roomTypes.form.allowShared')}
        </label>
      </fieldset>
      <ul data-testid="room-type-warnings" style={{ margin: 0, paddingInlineStart: 20 }}>
        {priceWarnings(draft).map((warning) => (
          <li key={warning}>{t(WARNING_MESSAGES[warning])}</li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 'var(--space-s2, 8px)' }}>
        <button disabled={disabled} type="submit" style={{ minHeight: 44 }}>
          {t('roomTypes.form.submit')}
        </button>
        <button disabled={disabled} type="button" onClick={onCancel} style={{ minHeight: 44 }}>
          {t('roomTypes.form.cancel')}
        </button>
      </div>
    </form>
  );
}
