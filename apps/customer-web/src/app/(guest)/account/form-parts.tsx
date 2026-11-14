'use client';

import {
  useEffect,
  useId,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { focusFieldByName } from '@pinehill/ui-web';
import { issueMessage } from './account-copy';
import type { FieldIssue } from './account-model';
import { useAccountText } from '../../../i18n/client';

const GAP = '16px';
const CONTROL = {
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 44,
  padding: '10px 12px',
  background: 'var(--color-surface, #FBFAF7)',
  color: 'var(--color-text, #1A1716)',
  border: '1px solid var(--color-borderStrong, #6F625C)',
  borderRadius: 'var(--radius-sm, 4px)',
  font: 'inherit',
} as const;

export function FormShell({
  title,
  intro,
  testId,
  onSubmit,
  children,
}: {
  title: string;
  intro: string;
  testId: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <section data-testid={testId} className="ph-card" style={{ display: 'grid', gap: GAP }}>
      <div className="ph-page-header" style={{ paddingBottom: 12 }}>
        <h1 className="ph-page-title" style={{ margin: 0 }}>
          {title}
        </h1>
        <p style={{ margin: 0, color: 'var(--color-textMuted, #5A4640)' }}>{intro}</p>
      </div>
      <form noValidate onSubmit={onSubmit} style={{ display: 'grid', gap: GAP }}>
        {children}
      </form>
    </section>
  );
}

export function TextField({
  name,
  label,
  value,
  onChange,
  issue,
  hint,
  type = 'text',
  autoComplete,
  inputMode,
  disabled,
  maxLength,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  issue: FieldIssue | undefined;
  hint?: string | null;
  type?: 'text' | 'tel' | 'email' | 'password';
  autoComplete?: string;
  inputMode?: 'tel' | 'email' | 'text';
  disabled: boolean;
  maxLength?: number;
}): ReactElement {
  const text = useAccountText();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [hint ? hintId : null, issue ? errorId : null].filter(Boolean).join(' ');
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={issue === undefined ? undefined : true}
        aria-describedby={described === '' ? undefined : described}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(event.target.value);
        }}
        style={{ ...CONTROL, ...(issue ? { borderColor: 'var(--color-danger, #9E1B32)' } : {}) }}
      />
      {hint ? (
        <span id={hintId} style={{ color: 'var(--color-textMuted, #5A4640)', fontSize: 13 }}>
          {hint}
        </span>
      ) : null}
      {issue ? (
        <span id={errorId} role="alert" style={{ color: 'var(--color-danger, #9E1B32)' }}>
          {issueMessage(text, issue)}
        </span>
      ) : null}
    </div>
  );
}

export function CheckField({
  name,
  label,
  note,
  checked,
  onChange,
  disabled,
}: {
  name: string;
  label: string;
  note: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}): ReactElement {
  const id = useId();
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <label
        htmlFor={id}
        style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minHeight: 44 }}
      >
        <input
          id={id}
          name={name}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={`${id}-note`}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
          style={{ width: 22, height: 22, marginTop: 2 }}
        />
        <span>{label}</span>
      </label>
      <span id={`${id}-note`} style={{ color: 'var(--color-textMuted, #5A4640)', fontSize: 13 }}>
        {note}
      </span>
    </div>
  );
}

export function SubmitButton({
  busy,
  label,
  testId,
}: {
  busy: boolean;
  label: string;
  testId: string;
}): ReactElement {
  const text = useAccountText();
  return (
    <button
      type="submit"
      data-testid={testId}
      className="ph-btn-primary"
      disabled={busy}
      aria-busy={busy}
      style={{
        width: '100%',
        cursor: busy ? 'progress' : 'pointer',
      }}
    >
      {busy ? text('submitting') : label}
    </button>
  );
}

export function Notice({
  tone,
  testId,
  lines,
  children,
}: {
  tone: 'error' | 'info' | 'success';
  testId: string;
  lines?: readonly string[];
  children?: ReactNode;
}): ReactElement {
  const color =
    tone === 'error'
      ? 'var(--color-danger, #9E1B32)'
      : tone === 'success'
        ? 'var(--color-success, #17663A)'
        : 'var(--color-text, #1A1716)';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={testId}
      style={{
        display: 'grid',
        gap: 6,
        padding: '12px 14px',
        border: '1px solid var(--color-border, #D9D2CC)',
        borderLeft: `3px solid ${color}`,
        background: 'var(--color-bg, #F3F2EE)',
        color,
      }}
    >
      {lines?.map((line) => (
        <p key={line} style={{ margin: 0 }}>
          {line}
        </p>
      ))}
      {children}
    </div>
  );
}

/** Chuyển tiêu điểm tới trường lỗi đầu tiên (§8.1: lỗi gắn trường, focus lỗi đầu). */
export function useFocusFirstIssue(
  issues: Readonly<Record<string, FieldIssue | undefined>>,
  order: readonly string[],
): void {
  const first = order.find((field) => issues[field] !== undefined);
  useEffect(() => {
    if (first !== undefined) focusFieldByName(first);
  }, [first, issues]);
}

export function SummaryAlert({ count }: { count: number }): ReactElement | null {
  const text = useAccountText();
  if (count === 0) return null;
  return (
    <Notice
      tone="error"
      testId="account-validation"
      lines={[text('validationSummary', { count })]}
    />
  );
}
