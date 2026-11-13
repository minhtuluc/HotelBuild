'use client';
import { useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { color, fontFamily, formatDateTimeVn, space, typography } from '@pinehill/ui-web';
import type { SalesClosureRow } from '@pinehill/contracts';
import {
  OPS_DIALOG_STYLE,
  OPS_TABLE_WRAP_STYLE,
  OPS_TABULAR_STYLE,
} from '../../components/editorial-styles';
import type { Cell, FieldIssue } from './model';
import { closureCells } from './model';
import { text } from './messages';

const KNOWN = [
  'REQUIRED',
  'TOO_LONG',
  'PCT_RANGE',
  'INVALID_DATE',
  'BEFORE_FROM',
  'UNCHANGED',
] as const;

/** Mã lỗi đã biết thì dịch; mã lạ của máy chủ hiện nguyên văn (không suy từ `message`). */
export function issueText(issue: string): string {
  const known = KNOWN.find((item) => item === issue);
  return known === undefined ? issue : text(known);
}

export const box: CSSProperties = { display: 'grid', gap: space.s3, minWidth: 0 };
const control: CSSProperties = {
  minHeight: 44,
  minWidth: 0,
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box',
};

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
  const id = `hb132-${name}`;
  const own = issues.filter((item) => item.field === name);
  const errorId = `${id}-error`;
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: color.text }}>
        {label}
      </label>
      {children({ id, invalid: own.length > 0, describedBy: own.length > 0 ? errorId : undefined })}
      {own.length > 0 ? (
        <span id={errorId} role="alert" style={{ color: color.danger, fontSize: 13 }}>
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
      style={OPS_DIALOG_STYLE}
    >
      <div style={{ display: 'grid', gap: space.s3 }}>
        <h2
          id={`${props.id}-title`}
          style={{ margin: 0, fontFamily: fontFamily.sans, fontSize: typography.h2.web }}
        >
          {props.title}
        </h2>
        {props.children}
        <div style={{ display: 'flex', gap: space.s2, flexWrap: 'wrap', marginTop: space.s1 }}>
          <button
            type="button"
            onClick={props.onConfirm}
            className="ph-btn-primary"
            data-testid={`${props.id}-confirm`}
          >
            {props.confirmLabel}
          </button>
          <button type="button" onClick={props.onCancel} className="ph-btn">
            {props.cancelLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function cellText(cell: Cell): string {
  const parts = [cell.closed ? text('closed') : text('opened')];
  if (cell.reason !== null) parts.push(cell.reason);
  if (cell.closed && cell.closedAt !== null)
    parts.push(text('closedAt', { time: formatDateTimeVn(cell.closedAt) }));
  if (cell.reopenedAt !== null)
    parts.push(text('reopenedAt', { time: formatDateTimeVn(cell.reopenedAt) }));
  return parts.join(' · ');
}

/** Ba cột đọc thẳng từ response: hiệu lực, thủ công, tự động — không mở lại hay suy cục bộ. */
export function ClosureTable({ rows }: { rows: readonly SalesClosureRow[] }): ReactElement {
  return (
    <div role="region" aria-label={text('closureTable')} tabIndex={0} style={OPS_TABLE_WRAP_STYLE}>
      <table data-testid="hb132-closure-table" style={OPS_TABULAR_STYLE}>
        <thead>
          <tr>
            <th scope="col">{text('colDate')}</th>
            <th scope="col">{text('colEffective')}</th>
            <th scope="col">{text('colManual')}</th>
            <th scope="col">{text('colAuto')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cells = closureCells(row);
            return (
              <tr key={`${row.roomTypeId}-${row.date}`}>
                <th scope="row">{row.date}</th>
                <td>
                  {cells.effective.closed ? text('closed') : text('opened')}
                  {cells.effective.source === null ? '' : ` (${cells.effective.source})`}
                </td>
                <td>{cellText(cells.manual)}</td>
                <td>{cellText(cells.automatic)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
