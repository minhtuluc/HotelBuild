'use client';

import type { ReactElement, Ref } from 'react';
import { color, radius, space, touchTargetPx } from '@pinehill/ui-web';

export const FIELD = {
  minHeight: touchTargetPx,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  padding: space.s2,
  background: color.surface,
  color: color.text,
  width: '100%',
  boxSizing: 'border-box',
} as const;

export const PRIMARY = {
  minHeight: touchTargetPx,
  border: `1px solid ${color.primary}`,
  borderRadius: radius.sm,
  padding: `0 ${space.s4}px`,
  background: color.primary,
  color: color.surface,
  fontWeight: 600,
} as const;

/** Trường nhập có nhãn hiển thị; lỗi gắn bằng `aria-describedby` + `aria-invalid` (§9.4), không dựa vào placeholder. */
export function TextField({
  id,
  label,
  type = 'text',
  value,
  error,
  autoComplete,
  disabled,
  maxLength,
  inputRef,
  onChange,
}: {
  id: string;
  label: string;
  type?: 'text' | 'password';
  value: string;
  error: string | undefined;
  autoComplete: string;
  disabled: boolean;
  maxLength: number;
  inputRef?: Ref<HTMLInputElement> | undefined;
  onChange: (value: string) => void;
}): ReactElement {
  const errorId = `${id}-error`;
  return (
    <div style={{ display: 'grid', gap: space.s1 }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        ref={inputRef}
        type={type}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        style={FIELD}
      />
      {error === undefined ? null : (
        <p id={errorId} data-testid={`${id}-error`} style={{ margin: 0, color: color.danger }}>
          {error}
        </p>
      )}
    </div>
  );
}

export const PAGE = {
  maxWidth: 420,
  margin: '0 auto',
  padding: space.s6,
  display: 'grid',
  gap: space.s4,
} as const;
