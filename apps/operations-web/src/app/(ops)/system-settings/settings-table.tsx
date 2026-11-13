'use client';

/** Bảng tham số hệ thống của SCR-17 (tách khỏi màn hình cho gọn). */
import type { ReactElement } from 'react';
import type { SystemSetting } from '@pinehill/contracts';
import { formatDateTimeVn, space } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_TABLE_WRAP_STYLE,
  OPS_TABULAR_STYLE,
} from '../../../components/editorial-styles';
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
    <div style={OPS_TABLE_WRAP_STYLE}>
      <table data-testid="settings-table" style={{ ...OPS_TABULAR_STYLE, width: '100%' }}>
        <caption
          style={{ textAlign: 'start', padding: `${space.s3}px ${space.s4}px`, fontWeight: 600 }}
        >
          {t('settings.title')}
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
                <div
                  style={{ display: 'flex', gap: space.s2, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <a href={auditLogHref(row.key)} data-testid={`setting-history-${row.key}`}>
                    {t('settings.history')}
                  </a>
                  {/* Trạng thái `forbidden` không render ô sửa (AC5). */}
                  {canEdit ? (
                    <button
                      type="button"
                      className="ph-btn"
                      onClick={() => onEdit(row)}
                      style={OPS_COMPACT_BTN_STYLE}
                    >
                      {t('settings.edit')}
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
