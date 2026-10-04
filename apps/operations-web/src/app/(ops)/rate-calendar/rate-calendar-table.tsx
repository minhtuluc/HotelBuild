'use client';

/**
 * Bảng lịch giá của SCR-26: mỗi hàng một ngày, cột giá/nguồn/mùa lấy **nguyên** từ phản hồi
 * `GET rate-calendar` (BR-RATE-02) — bảng không tính lại giá và không suy mùa thắng. Cột cuối là ô
 * nhập giá mới; cảnh báo sàn–trần ở đây chỉ để nhắc, máy chủ vẫn là nơi chặn (BR-RATE-03/04).
 */
import type { ReactElement } from 'react';
import type { RateCalendar } from '@pinehill/contracts';
import { formatMoney, formatStatusWithEnum } from '@pinehill/ui-web';
import { t } from '../../../lib/i18n';
import { toMoney } from '../../../lib/money';
import { priceWarning } from '../../../lib/rate-calendar';

export type RateCalendarEntry = RateCalendar['entries'][number];

/** Một ngày hiển thị: giá/nguồn/mùa đúng như máy chủ trả, không qua suy diễn ở giao diện. */
export interface RateDay {
  date: string;
  price: number;
  source: RateCalendarEntry['source'];
  seasonName: RateCalendarEntry['seasonName'];
}

interface RateCalendarTableProps {
  days: readonly RateDay[];
  prices: Readonly<Record<string, string>>;
  onPriceChange: (date: string, value: string) => void;
  minPrice: number | undefined;
  maxPrice: number | undefined;
}

export function RateCalendarTable({
  days,
  prices,
  onPriceChange,
  minPrice,
  maxPrice,
}: RateCalendarTableProps): ReactElement {
  const headers = [
    t('rate.col.date'),
    t('rate.col.price'),
    t('rate.col.source'),
    t('rate.col.season'),
    t('rate.col.newPrice'),
    t('rate.col.warning'),
  ];
  return (
    <div style={{ overflowX: 'auto', minWidth: 0 }}>
      <table
        data-testid="rate-calendar-table"
        style={{ width: '100%', borderCollapse: 'collapse' }}
      >
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
          {t('rate.title')}
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
          {days.map((day) => {
            const typed = prices[day.date] ?? '';
            const parsed = toMoney(typed);
            const warning =
              parsed === null || minPrice === undefined || maxPrice === undefined
                ? null
                : priceWarning(parsed, minPrice, maxPrice);
            return (
              <tr key={day.date} data-testid={`rate-row-${day.date}`}>
                <th scope="row" style={{ textAlign: 'start' }}>
                  {day.date}
                </th>
                <td data-testid={`rate-price-text-${day.date}`}>{formatMoney(day.price)}</td>
                <td data-testid={`rate-source-${day.date}`}>
                  {day.source === undefined
                    ? t('rate.none')
                    : formatStatusWithEnum(t(`enum.rateSource.${day.source}`), day.source)}
                </td>
                <td data-testid={`rate-season-${day.date}`}>{day.seasonName ?? t('rate.none')}</td>
                <td>
                  <input
                    type="text"
                    inputMode="numeric"
                    name={day.date}
                    aria-label={`${t('rate.col.newPrice')} ${day.date}`}
                    data-testid={`rate-price-${day.date}`}
                    value={typed}
                    onChange={(event) => {
                      onPriceChange(day.date, event.target.value);
                    }}
                    style={{ width: '9rem', minHeight: 44 }}
                  />
                </td>
                <td data-testid={`rate-warning-${day.date}`}>
                  {warning === null ? '' : t(`rate.warn.${warning}`)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
