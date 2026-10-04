'use client';

/** Bảng danh sách khuyến mãi của SCR-29 (tách khỏi màn hình cho gọn). */
import type { ReactElement } from 'react';
import type { PromotionSummary } from '@pinehill/contracts';
import { formatDateTimeVn } from '@pinehill/ui-web';
import { t } from '../../../lib/i18n';
import { usageText } from '../../../lib/promotions';

export function PromotionTable({ rows }: { rows: readonly PromotionSummary[] }): ReactElement {
  const headers = [
    t('promotions.col.code'),
    t('promotions.col.type'),
    t('promotions.col.value'),
    t('promotions.col.minNights'),
    t('promotions.col.validity'),
    t('promotions.col.usage'),
    t('promotions.col.scope'),
    t('promotions.col.status'),
  ];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="promotions-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
          {t('promotions.list.title')}
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
            <tr key={row.id} data-testid={`promotion-${row.code}`}>
              <td>{row.code}</td>
              <td>
                {t(row.type === 'PERCENT' ? 'promotions.type.PERCENT' : 'promotions.type.AMOUNT')}
              </td>
              <td>
                {row.value}
                {row.type === 'PERCENT' ? '%' : ' ₫'}
              </td>
              <td>{row.minNights}</td>
              <td>
                {formatDateTimeVn(row.validFrom)} → {formatDateTimeVn(row.validTo)}
              </td>
              <td data-testid={`promotion-usage-${row.code}`}>{usageText(row)}</td>
              <td>
                {row.channelScope.join(', ')} · {row.roomTypeScope.join(', ')}
              </td>
              <td>
                {row.status === 'ACTIVE'
                  ? t('promotions.status.ACTIVE')
                  : t('promotions.status.INACTIVE')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
