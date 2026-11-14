'use client';
/**
 * HB-310/HB-311 — khung sửa / ngừng dùng chung cho cấu hình giá (mùa SCR-27, khuyến mãi SCR-29).
 * Các trường riêng của màn đặt trong `children`; khung lo phần chung: lý do ghi nhật ký, báo lỗi ngay
 * trong khung (không thay cả màn), hàng nút Huỷ / Lưu.
 */
import type { FormEvent, ReactElement, ReactNode } from 'react';
import { makeTranslate } from '@pinehill/ui-web/messages';
import { REASON_MAX, type EditFailure, type EditIssue } from '../lib/config-edit';
import { OPS_FIELD_LABEL_STYLE, OPS_SUBTITLE_STYLE, opsNoticeStyle } from './editorial-styles';

const editText = makeTranslate({
  reason: 'Lý do thay đổi',
  reasonHelp: 'Ghi vào nhật ký thao tác; tối đa 500 ký tự.',
  cancel: 'Huỷ',
  reload: 'Tải lại danh sách',
  noChange: 'Chưa có trường nào thay đổi.',
  forbidden: 'Chỉ chủ chuỗi được sửa hoặc ngừng mục này. Bạn vẫn xem được danh sách.',
  conflict: 'Mục này vừa được người khác sửa. Tải lại để xem bản mới nhất rồi sửa lại.',
  invalid: 'Máy chủ chưa nhận bản sửa:',
  unknown:
    'Chưa rõ thay đổi đã được lưu hay chưa (mã tham chiếu {reference}). Tải lại danh sách để kiểm tra trước khi thử lại.',
  noReference: 'không có',
  issueREQUIRED: 'bắt buộc nhập',
  issueTOO_LONG: 'quá dài',
  issueOUT_OF_RANGE: 'ngoài khoảng cho phép',
  issueNOT_INTEGER: 'phải là số nguyên',
  issueBEFORE_START: 'phải sau ngày bắt đầu',
  issueNOT_POSITIVE: 'phải lớn hơn 0',
  issuePATTERN: 'sai định dạng',
  issueBELOW_USED: 'không được nhỏ hơn số lượt đã dùng',
} as const);

const ISSUE_KEYS = {
  REQUIRED: 'issueREQUIRED',
  TOO_LONG: 'issueTOO_LONG',
  OUT_OF_RANGE: 'issueOUT_OF_RANGE',
  NOT_INTEGER: 'issueNOT_INTEGER',
  BEFORE_START: 'issueBEFORE_START',
  NOT_POSITIVE: 'issueNOT_POSITIVE',
  PATTERN: 'issuePATTERN',
  BELOW_USED: 'issueBELOW_USED',
} as const;

function issueText(issue: string): string {
  const key = Object.entries(ISSUE_KEYS).find(([code]) => code === issue)?.[1];
  return key === undefined ? issue : editText(key);
}

export function ConfigEditPanel({
  testId,
  title,
  note,
  children,
  reason,
  onReason,
  issues,
  failure,
  noChange,
  busy,
  danger,
  submitLabel,
  fieldLabel,
  onSubmit,
  onCancel,
  onReload,
}: {
  testId: string;
  title: string;
  note?: string | undefined;
  children?: ReactNode;
  reason: string;
  onReason: (value: string) => void;
  issues: readonly EditIssue[];
  failure: EditFailure | null;
  noChange: boolean;
  busy: boolean;
  danger?: boolean;
  submitLabel: string;
  fieldLabel: (field: string) => string;
  onSubmit: () => void;
  onCancel: () => void;
  onReload: () => void;
}): ReactElement {
  const reasonIssue = issues.find((issue) => issue.field === 'reason');
  const otherIssues = issues.filter((issue) => issue.field !== 'reason');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form
      data-testid={testId}
      className="ph-card"
      onSubmit={submit}
      aria-busy={busy || undefined}
      style={{ display: 'grid', gap: 16 }}
    >
      <h2 style={OPS_SUBTITLE_STYLE}>{title}</h2>
      {note ? <p style={{ margin: 0 }}>{note}</p> : null}
      {children ? <div className="ph-filter-row ph-edit-fields">{children}</div> : null}
      <label style={OPS_FIELD_LABEL_STYLE}>
        {editText('reason')}
        <textarea
          name="reason"
          rows={2}
          maxLength={REASON_MAX + 50}
          value={reason}
          aria-invalid={reasonIssue ? true : undefined}
          aria-describedby={`${testId}-reason-help`}
          onChange={(event) => onReason(event.target.value)}
          style={{ maxWidth: '36rem', resize: 'vertical' }}
        />
        <span
          id={`${testId}-reason-help`}
          style={{ fontWeight: 400, color: 'var(--color-textMuted)' }}
        >
          {reasonIssue
            ? `${editText('reason')}: ${issueText(reasonIssue.issue)}`
            : editText('reasonHelp')}
        </span>
      </label>
      {otherIssues.length > 0 ? (
        <ul
          data-testid={`${testId}-issues`}
          role="alert"
          style={{ ...opsNoticeStyle('danger'), paddingInlineStart: 32 }}
        >
          {otherIssues.map((issue) => (
            <li key={`${issue.field}-${issue.issue}`}>
              {fieldLabel(issue.field)}: {issueText(issue.issue)}
            </li>
          ))}
        </ul>
      ) : null}
      {noChange ? (
        <p role="status" style={opsNoticeStyle('info')}>
          {editText('noChange')}
        </p>
      ) : null}
      <FailureNotice
        testId={testId}
        failure={failure}
        fieldLabel={fieldLabel}
        onReload={onReload}
      />
      <div className="ph-actions">
        <button type="button" className="ph-btn" disabled={busy} onClick={onCancel}>
          {editText('cancel')}
        </button>
        <button
          type="submit"
          className={danger ? 'ph-btn-danger' : 'ph-btn-primary'}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function FailureNotice({
  testId,
  failure,
  fieldLabel,
  onReload,
}: {
  testId: string;
  failure: EditFailure | null;
  fieldLabel: (field: string) => string;
  onReload: () => void;
}): ReactElement | null {
  if (failure === null) return null;
  const reload = (
    <div className="ph-actions">
      <button type="button" className="ph-btn" onClick={onReload}>
        {editText('reload')}
      </button>
    </div>
  );
  if (failure.kind === 'forbidden')
    return (
      <p role="alert" data-testid={`${testId}-forbidden`} style={opsNoticeStyle('warning')}>
        {editText('forbidden')}
      </p>
    );
  if (failure.kind === 'conflict')
    return (
      <div role="alert" data-testid={`${testId}-conflict`} style={opsNoticeStyle('warning')}>
        <p style={{ margin: 0 }}>{editText('conflict')}</p>
        {reload}
      </div>
    );
  if (failure.kind === 'invalid')
    return (
      <div role="alert" data-testid={`${testId}-invalid`} style={opsNoticeStyle('danger')}>
        <p style={{ margin: 0 }}>
          {editText('invalid')} {failure.details.length === 0 ? (failure.code ?? '') : ''}
        </p>
        {failure.details.length > 0 ? (
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            {failure.details.map((issue) => (
              <li key={`${issue.field}-${issue.issue}`}>
                {fieldLabel(issue.field)}: {issueText(issue.issue)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  return (
    <div role="alert" data-testid={`${testId}-unknown`} style={opsNoticeStyle('warning')}>
      <p style={{ margin: 0 }}>
        {editText('unknown', { reference: failure.reference ?? editText('noReference') })}
      </p>
      {reload}
    </div>
  );
}
