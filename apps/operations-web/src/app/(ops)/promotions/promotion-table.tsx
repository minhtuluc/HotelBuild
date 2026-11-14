'use client';

/** Bảng danh sách khuyến mãi của SCR-29 (tách khỏi màn hình cho gọn). */
import type { ReactElement } from 'react';
import type { PromotionSummary } from '@pinehill/contracts';
import { formatDateTimeVn, space } from '@pinehill/ui-web';
import { OPS_TABLE_WRAP_STYLE, OPS_TABULAR_STYLE } from '../../../components/editorial-styles';
import { t } from '../../../lib/i18n';
import { usageText } from '../../../lib/promotions';

export function PromotionTable({
  rows,
  onEdit,
  onToggle,
}: {
  rows: readonly PromotionSummary[];
  onEdit?: ((promotion: PromotionSummary) => void) | undefined;
  onToggle?: ((promotion: PromotionSummary) => void) | undefined;
}): ReactElement {
  const actions = onEdit !== undefined && onToggle !== undefined;
  const headers = [
    t('promotions.col.code'),
    t('promotions.col.type'),
    t('promotions.col.value'),
    t('promotions.col.minNights'),
    t('promotions.col.validity'),
    t('promotions.col.usage'),
    t('promotions.col.scope'),
    t('promotions.col.status'),
    ...(actions ? [t('promotions.col.actions')] : []),
  ];
  return (
    <div style={OPS_TABLE_WRAP_STYLE}>
      <table data-testid="promotions-table" style={{ ...OPS_TABULAR_STYLE, width: '100%' }}>
        <caption
          style={{ textAlign: 'start', padding: `${space.s3}px ${space.s4}px`, fontWeight: 600 }}
        >
          {t('promotions.list.title')}
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
              <td data-testid={`promotion-status-${row.code}`}>
                {row.status === 'ACTIVE'
                  ? t('promotions.status.ACTIVE')
                  : t('promotions.status.INACTIVE')}
              </td>
              {actions ? (
                <td>
                  <div className="ph-actions" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <button type="button" className="ph-btn" onClick={() => onEdit(row)}>
                      {t('promotions.edit')}
                    </button>
                    <button
                      type="button"
                      className={row.status === 'ACTIVE' ? 'ph-btn-danger' : 'ph-btn'}
                      onClick={() => onToggle(row)}
                    >
                      {t(row.status === 'ACTIVE' ? 'promotions.deactivate' : 'promotions.activate')}
                    </button>
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
