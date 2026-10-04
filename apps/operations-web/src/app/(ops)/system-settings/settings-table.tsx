'use client';

/** Bảng tham số hệ thống của SCR-17 (tách khỏi màn hình cho gọn). */
import type { ReactElement } from 'react';
import type { SystemSetting } from '@pinehill/contracts';
import { formatDateTimeVn } from '@pinehill/ui-web';
import { t } from '../../../lib/i18n';
import { auditLogHref } from '../../../lib/system-settings';

export function SettingsTable({
  rows,
  canEdit,
  onEdit,
}: {
  rows: readonly SystemSetting[];
  canEdit: boolean;
  onEdit: (setting: SystemSetting) => void;
}): ReactElement {
  const headers = [
    t('settings.col.key'),
    t('settings.col.value'),
    t('settings.col.type'),
    t('settings.col.description'),
    t('settings.col.updatedBy'),
    t('settings.col.updatedAt'),
    t('settings.col.version'),
    t('settings.col.actions'),
  ];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="settings-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
          {t('settings.title')}
        </caption>
        <thead>
          <tr>
            {headers.map((label) => (
              <th
                key={label}
                scope="col"
                style={{ textAlign: 'start', borderBottom: '1px solid var(--color-border)' }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-testid={`setting-${row.key}`}>
              <td>
                <code>{row.key}</code>
              </td>
              <td>{row.value}</td>
              <td>{row.valueType}</td>
              <td>{row.description}</td>
              <td>{row.updatedBy}</td>
              <td>{formatDateTimeVn(row.updatedAt)}</td>
              <td>{row.version}</td>
              <td>
                <a href={auditLogHref(row.key)} data-testid={`setting-history-${row.key}`}>
                  {t('settings.history')}
                </a>
                {/* Trạng thái `forbidden` không render ô sửa (AC5). */}
                {canEdit ? (
                  <button type="button" onClick={() => onEdit(row)} style={{ minHeight: 44 }}>
                    {t('settings.edit')}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
