'use client';

/** Bảng nhật ký kiểm toán (SCR-16) — chỉ đọc; chi tiết chỉ hiện lại trường an toàn, không JSON thô. */
import type { ReactElement } from 'react';
import type { AuditLogEntry } from '@pinehill/contracts';
import { formatDateTimeVn, space } from '@pinehill/ui-web';
import { OPS_TABLE_WRAP_STYLE, OPS_TABULAR_STYLE } from '../../../components/editorial-styles';
import { t } from '../../../lib/i18n';

function Row({ entry }: { entry: AuditLogEntry }): ReactElement {
  return (
    <tr>
      <td>{formatDateTimeVn(entry.createdAt)}</td>
      <td>{entry.actorId}</td>
      <td>{entry.action}</td>
      <td>{entry.entityType}</td>
      <td>{entry.entityId}</td>
      <td>{entry.reason ?? ''}</td>
      <td>
        <details>
          <summary>{t('audit.detail')}</summary>
          <dl style={{ margin: 0 }}>
            <dt>{t('audit.col.time')}</dt>
            <dd>{formatDateTimeVn(entry.createdAt)}</dd>
            <dt>{t('audit.col.actor')}</dt>
            <dd>{entry.actorId}</dd>
            <dt>{t('audit.col.action')}</dt>
            <dd>{entry.action}</dd>
            <dt>{t('audit.col.entityType')}</dt>
            <dd>{entry.entityType}</dd>
            <dt>{t('audit.col.entityId')}</dt>
            <dd>{entry.entityId}</dd>
            <dt>{t('audit.col.reason')}</dt>
            <dd>{entry.reason ?? ''}</dd>
          </dl>
        </details>
      </td>
    </tr>
  );
}

export function AuditLogTable({ rows }: { rows: readonly AuditLogEntry[] }): ReactElement {
  const headers = [
    t('audit.col.time'),
    t('audit.col.actor'),
    t('audit.col.action'),
    t('audit.col.entityType'),
    t('audit.col.entityId'),
    t('audit.col.reason'),
    t('audit.col.detail'),
  ];
  return (
    <div style={OPS_TABLE_WRAP_STYLE}>
      <table data-testid="audit-table" style={{ ...OPS_TABULAR_STYLE, width: '100%' }}>
        <caption
          style={{ textAlign: 'start', padding: `${space.s3}px ${space.s4}px`, fontWeight: 600 }}
        >
          {t('audit.title')}
        </caption>
        <thead>
          <tr>
            {headers.map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <Row key={entry.id} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
