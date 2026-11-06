'use client';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import type { FieldIssue } from './model';
import { text } from './messages';

const KNOWN = [
  'REQUIRED',
  'TOO_LONG',
  'PIN_SHAPE',
  'AMOUNT',
  'EVIDENCE_SHAPE',
  'DIFFERENT',
] as const;

/** Mã lỗi đã biết thì dịch; mã lạ của máy chủ hiện nguyên văn (không suy từ `message`). */
export function issueText(issue: string): string {
  const known = KNOWN.find((item) => item === issue);
  return known === undefined ? issue : text(known);
}

/** Gắn lỗi của trường `from` vào ô có `name` riêng (tránh trùng `id` giữa các hộp thoại cùng trang). */
export function remap(
  issues: readonly FieldIssue[],
  map: Readonly<Record<string, string>>,
): readonly FieldIssue[] {
  return issues.map((item) => ({ ...item, field: map[item.field] ?? item.field }));
}

export const box = { display: 'grid', gap: 'var(--space-s3, 12px)', minWidth: 0 } as const;
const control = { minHeight: 44, minWidth: 0, maxWidth: '100%' } as const;

export function Field({
  name,
  label,
  issues,
  children,
}: {
  name: string;
  label: string;
  issues: readonly FieldIssue[];
  children: (props: { id: string; invalid: boolean; describedBy: string | undefined }) => ReactNode;
}): ReactElement {
  const id = `hb137-${name}`;
  const own = issues.filter((item) => item.field === name);
  const errorId = `${id}-error`;
  return (
    <div style={box}>
      <label htmlFor={id}>{label}</label>
      {children({ id, invalid: own.length > 0, describedBy: own.length > 0 ? errorId : undefined })}
      {own.length > 0 ? (
        <span id={errorId} role="alert">
          {own.map((item) => issueText(item.issue)).join('; ')}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput(props: {
  name: string;
  label: string;
  value: string;
  issues: readonly FieldIssue[];
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}): ReactElement {
  return (
    <Field name={props.name} label={props.label} issues={props.issues}>
      {({ id, invalid, describedBy }) => (
        <input
          id={id}
          name={props.name}
          type={props.type ?? 'text'}
          value={props.value}
          disabled={props.disabled === true}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => props.onChange(event.target.value)}
          style={control}
        />
      )}
    </Field>
  );
}

export function SelectInput(props: {
  name: string;
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (value: string) => void;
  issues?: readonly FieldIssue[];
}): ReactElement {
  return (
    <Field name={props.name} label={props.label} issues={props.issues ?? []}>
      {({ id, invalid, describedBy }) => (
        <select
          id={id}
          name={props.name}
          value={props.value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => props.onChange(event.target.value)}
          style={control}
        >
          {props.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * Hộp thoại xác nhận bằng `<dialog>` gốc: khoá focus bên trong khi mở và trả focus về nút đã mở nó khi
 * đóng, nên bàn phím không lạc ra sau lớp phủ.
 */
export function ConfirmDialog(props: {
  id: string;
  open: boolean;
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const { open, onCancel } = props;
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${props.id}-title`}
      onCancel={onCancel}
      data-testid={props.id}
    >
      <h2 id={`${props.id}-title`}>{props.title}</h2>
      {props.children}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={props.onConfirm}
          style={control}
          data-testid={`${props.id}-confirm`}
        >
          {props.confirmLabel}
        </button>
        <button type="button" onClick={props.onCancel} style={control}>
          {props.cancelLabel}
        </button>
      </div>
    </dialog>
  );
}
