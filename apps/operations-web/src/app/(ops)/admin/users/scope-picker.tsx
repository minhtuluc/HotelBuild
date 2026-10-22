'use client';
import type { ReactElement } from 'react';
import { space } from '@pinehill/ui-web';
import type { PropertyOption } from './controller';
import { parseScopeInput } from './users-model';
import { userText } from './messages';
import { CONTROL, FIELD } from './styles';

/**
 * Chọn phạm vi cơ sở: tick từ danh sách cơ sở máy chủ trả; nếu vai trò này không đọc được danh sách
 * (`options === null`) thì nhập mã cơ sở thủ công — máy chủ vẫn là nơi kiểm mã hợp lệ.
 */
export function ScopePicker({
  options,
  value,
  disabled,
  onChange,
}: {
  options: readonly PropertyOption[] | null;
  value: readonly string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}): ReactElement {
  if (options === null)
    return (
      <label style={FIELD}>
        {userText('scopeManual')}
        <input
          name="propertyScope"
          style={CONTROL}
          disabled={disabled}
          defaultValue={value.join(', ')}
          onChange={(event) => {
            onChange(parseScopeInput(event.target.value));
          }}
        />
        <span style={{ fontSize: 14 }}>{userText('scopeManualHint')}</span>
      </label>
    );
  return (
    <fieldset style={{ display: 'grid', gap: space.s2, border: 0, padding: 0, margin: 0 }}>
      <legend style={{ padding: 0, marginBottom: 4 }}>{userText('scope')}</legend>
      {options.map((property) => (
        <label
          key={property.id}
          style={{ display: 'flex', gap: space.s2, alignItems: 'center', minHeight: 44 }}
        >
          <input
            type="checkbox"
            name="propertyScope"
            value={property.id}
            disabled={disabled}
            checked={value.includes(property.id)}
            onChange={(event) => {
              onChange(
                event.target.checked
                  ? [...value, property.id]
                  : value.filter((id) => id !== property.id),
              );
            }}
          />
          {property.name}
        </label>
      ))}
    </fieldset>
  );
}
