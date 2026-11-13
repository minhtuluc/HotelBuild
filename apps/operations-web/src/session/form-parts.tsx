'use client';

import type { CSSProperties, ReactElement, ReactNode, Ref } from 'react';
import { PineHillBrand, color, fontFamily, radius, space, touchTargetPx } from '@pinehill/ui-web';
import { authText as text } from './messages';

export const FIELD: CSSProperties = {
  minHeight: touchTargetPx,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  padding: `${space.s2}px ${space.s3}px`,
  background: color.surface,
  color: color.text,
  width: '100%',
  boxSizing: 'border-box',
};

/** Nút chính của form đăng nhập: dùng cùng class `.ph-btn-primary`; style này chỉ đặt vị trí trong lưới. */
export const PRIMARY: CSSProperties = {
  width: '100%',
};

/** Nút phụ (đăng xuất, quay lại): class `.ph-btn`, nằm sát trái dưới form. */
export const SECONDARY: CSSProperties = {
  justifySelf: 'start',
};

export const ALERT_BANNER: CSSProperties = {
  margin: 0,
  padding: `${space.s2}px ${space.s3}px`,
  background: '#FBEFF1',
  border: `1px solid ${color.border}`,
  boxShadow: `inset 0 0 0 1px ${color.danger}`,
  borderRadius: radius.sm,
  color: color.danger,
  fontSize: 14,
};

export const WARN_BANNER: CSSProperties = {
  margin: 0,
  padding: `${space.s2}px ${space.s3}px`,
  background: '#FBF3E6',
  border: `1px solid ${color.border}`,
  boxShadow: `inset 0 0 0 1px ${color.warning}`,
  borderRadius: radius.sm,
  color: color.warning,
  fontSize: 14,
};

export const PAGE: CSSProperties = {
  maxWidth: 460,
  margin: '0 auto',
  padding: space.s6,
  display: 'grid',
  gap: space.s4,
};

const SHELL_STYLE: CSSProperties = {
  minHeight: '100dvh',
  background: color.dark,
  padding: `clamp(${space.s6}px, 5vw, ${space.s12}px) ${space.s4}px`,
  display: 'grid',
  alignContent: 'center',
  justifyItems: 'center',
  boxSizing: 'border-box',
};

const CARD_STYLE: CSSProperties = {
  width: '100%',
  maxWidth: 460,
  background: color.surface,
  padding: `clamp(${space.s6}px, 4vw, ${space.s10}px)`,
  display: 'grid',
  gap: space.s4,
  boxSizing: 'border-box',
};

const TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontFamily: fontFamily.sans,
  fontSize: 24,
  fontWeight: 600,
  lineHeight: 1.25,
  color: color.text,
};

export function AuthCard({
  titleId,
  title,
  intro,
  introTestId,
  children,
}: {
  titleId: string;
  title: string;
  intro: string;
  introTestId?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div style={SHELL_STYLE}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <section className="ph-auth-sheet" style={CARD_STYLE} aria-labelledby={titleId}>
          <div style={{ paddingBottom: space.s3, borderBottom: `1px solid ${color.border}` }}>
            <PineHillBrand subtitle={text('brandSubtitle')} />
          </div>
          <div style={{ display: 'grid', gap: space.s2 }}>
            <h1 id={titleId} style={TITLE_STYLE}>
              {title}
            </h1>
            <p
              data-testid={introTestId}
              style={{ margin: 0, color: 'var(--color-textMuted)', fontSize: 15 }}
            >
              {intro}
            </p>
          </div>
          {children}
        </section>
      </div>
    </div>
  );
}

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
      <label htmlFor={id} style={{ fontSize: 14, fontWeight: 500, color: color.text }}>
        {label}
      </label>
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
        style={{
          ...FIELD,
          borderColor: error === undefined ? color.borderStrong : color.danger,
        }}
      />
      {error === undefined ? null : (
        <p
          id={errorId}
          data-testid={`${id}-error`}
          style={{ margin: 0, color: color.danger, fontSize: 13 }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
