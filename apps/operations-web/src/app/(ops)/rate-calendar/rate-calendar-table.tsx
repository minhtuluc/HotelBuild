'use client';

/**
 * Bảng lịch giá của SCR-26: mỗi hàng một ngày, cột giá/nguồn/mùa lấy **nguyên** từ phản hồi
 * `GET rate-calendar` (BR-RATE-02) — bảng không tính lại giá và không suy mùa thắng. Cột cuối là ô
 * nhập giá mới; cảnh báo sàn–trần ở đây chỉ để nhắc, máy chủ vẫn là nơi chặn (BR-RATE-03/04).
 */
import type { ReactElement } from 'react';
import type { RateCalendar } from '@pinehill/contracts';
import { color, formatMoney, formatStatusWithEnum, space } from '@pinehill/ui-web';
import { OPS_TABLE_WRAP_STYLE, OPS_TABULAR_STYLE } from '../../../components/editorial-styles';
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
    <div style={OPS_TABLE_WRAP_STYLE}>
      <table data-testid="rate-calendar-table" style={OPS_TABULAR_STYLE}>
        <caption
          style={{ textAlign: 'start', padding: space.s3, fontWeight: 500, color: color.text }}
        >
          {t('rate.title')}
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
          {days.map((day) => {
            const typed = prices[day.date] ?? '';
            const parsed = toMoney(typed);
            const warning =
              parsed === null || minPrice === undefined || maxPrice === undefined
                ? null
                : priceWarning(parsed, minPrice, maxPrice);
            return (
              <tr key={day.date} data-testid={`rate-row-${day.date}`}>
                <th scope="row" style={{ textAlign: 'start', fontWeight: 500 }}>
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
                    style={{ width: '9rem', minHeight: 44, ...OPS_TABULAR_STYLE }}
                  />
                </td>
                <td
                  data-testid={`rate-warning-${day.date}`}
                  style={warning === null ? undefined : { color: color.warning, fontWeight: 500 }}
                >
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
