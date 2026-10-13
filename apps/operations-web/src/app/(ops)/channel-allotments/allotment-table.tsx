'use client';

/** Bảng allotment của SCR-25: mỗi dòng là một ngày kèm ô nhập hạn mức, mức đã dùng và cảnh báo. */
import type { ReactElement } from 'react';
import { t, type OperationsMessageKey } from '../../../lib/i18n';
import { allotmentText } from './messages';
import { rowIssue, type AllotmentDraftRow, type FieldIssue } from '../../../lib/allotments';

export interface AllotmentRowView {
  row: AllotmentDraftRow;
  index: number;
}

/** Nhãn tiếng Việt cho mã lỗi/cảnh báo của lib (không viết cứng chuỗi trong component). */
const ISSUE_LABEL: Readonly<Record<string, OperationsMessageKey>> = {
  OUT_OF_RANGE: 'allotments.issue.OUT_OF_RANGE',
  OVER_SELLING_UNITS: 'allotments.issue.OVER_SELLING_UNITS',
  RANGE_INVALID: 'allotments.issue.RANGE_INVALID',
  TOO_MANY_DAYS: 'allotments.issue.TOO_MANY_DAYS',
  BEFORE_START: 'allotments.issue.BEFORE_START',
  MISSING_ETAG: 'allotments.issue.MISSING_ETAG',
  UNCHANGED: 'allotments.issue.UNCHANGED',
};

export function issueLabel(issue: FieldIssue): string {
  const key = ISSUE_LABEL[issue.issue];
  return key === undefined ? issue.issue : t(key);
}

export function AllotmentTable({
  rows,
  sellingUnits,
  editable,
  disabled = false,
  onChange,
}: {
  rows: readonly AllotmentDraftRow[];
  sellingUnits: number | undefined;
  editable: boolean;
  disabled?: boolean;
  onChange: (index: number, value: string) => void;
}): ReactElement {
  return (
    <div
      role="region"
      aria-label={allotmentText('scroll')}
      tabIndex={0}
      style={{ maxWidth: '100%', overflowX: 'auto' }}
    >
      <table data-testid="allotments-table" style={{ borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
          {sellingUnits === undefined
            ? t('allotments.captionNoUnits')
            : t('allotments.caption', { units: sellingUnits })}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'start' }}>
              {t('allotments.col.date')}
            </th>
            <th scope="col" style={{ textAlign: 'start' }}>
              {t('allotments.col.allotment')}
            </th>
            <th scope="col" style={{ textAlign: 'start' }}>
              {t('allotments.col.used')}
            </th>
            <th scope="col" style={{ textAlign: 'start' }}>
              {t('allotments.col.warnings')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const issue = rowIssue(row, sellingUnits);
            return (
              <tr
                key={row.date}
                data-testid={`allotment-row-${row.date}`}
                data-issue={issue?.issue ?? ''}
              >
                <td>{row.date}</td>
                <td>
                  {editable ? (
                    <input
                      disabled={disabled}
                      name={`allotment-${row.date}`}
                      aria-label={t('allotments.inputLabel', { date: row.date })}
                      value={row.value}
                      onChange={(event) => onChange(index, event.target.value)}
                    />
                  ) : (
                    row.value || allotmentText('unconfigured')
                  )}
                </td>
                <td data-testid={`allotment-used-${row.date}`}>{row.used ?? '—'}</td>
                <td data-testid={`allotment-issue-${row.date}`}>
                  {issue === null ? '' : issueLabel(issue)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
