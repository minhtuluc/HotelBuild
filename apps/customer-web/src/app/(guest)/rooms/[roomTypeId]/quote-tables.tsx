'use client';

/** Bảng giá từng đêm và tổng hợp của SCR-03 — in nguyên số `POST /quotes` trả (BR-RATE-17). */
import type { ReactElement } from 'react';
import { formatDateTimeVn, formatMoney } from '@pinehill/ui-web';
import type { Quote } from '@pinehill/contracts';
import { useLocale, useT } from '../../../../i18n/client';
import { nightRows } from './quote-model';
import { calendarDay, Denomination } from '../../../../components/stamps';
import { calendarDate } from '../../../../i18n/format';

/** Tem vẽ tối đa trên dải; kỳ dài hơn vẫn đầy đủ trong bảng giá từng đêm ngay dưới. */
const MAX_PRICE_STAMPS = 7;

/**
 * Dải tem giá: mỗi đêm một con tem, mệnh giá là `nightlyPrice` máy chủ trả; đêm bị kẹp sàn/trần có
 * khung đứt (hình thức, không chỉ màu). Bảng `nights-table` bên dưới vẫn là nguồn đọc đầy đủ.
 */
export function PriceStrip({ quote }: { quote: Quote }): ReactElement {
  const locale = useLocale();
  const t = useT();
  const rows = nightRows(quote);
  const shown = rows.slice(0, MAX_PRICE_STAMPS);
  const hasClamped = rows.some((row) => row.clamped);
  return (
    <figure data-testid="price-strip" style={{ margin: 0, display: 'grid', gap: 8 }}>
      <div className="ph-price-strip" aria-hidden="true">
        <div className="ph-stamp-lift" style={{ display: 'flex', flexWrap: 'wrap' }}>
          {shown.map((row, index) => {
            const day = calendarDay(row.date, locale);
            return (
              <div
                key={row.date}
                className="ph-stamp ph-price-stamp"
                data-tone={index % 3}
                data-clamped={row.clamped ? 'true' : 'false'}
              >
                <div className="ph-stamp-face">
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    {day?.weekday} {day?.dayMonth}
                  </span>
                  <Denomination amount={row.nightlyPrice} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="ph-price-total">
          <small>{t('guest.rooms.strip.total', { nights: rows.length })}</small>
          <Denomination amount={quote.subtotal} />
        </div>
      </div>
      {hasClamped ? (
        <figcaption style={{ fontSize: 13, color: 'var(--color-textMuted)' }}>
          {t('guest.rooms.strip.clamped')}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function NightsTable({ quote }: { quote: Quote }): ReactElement {
  const locale = useLocale();
  const t = useT();
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="ph-table-wrap">
        <table data-testid="nights-table">
          <caption>{t('guest.rooms.nights.title')}</caption>
          <thead>
            <tr>
              {[
                t('guest.rooms.col.date'),
                t('guest.rooms.col.basePrice'),
                t('guest.rooms.col.nightlyPrice'),
                t('guest.rooms.col.flags'),
              ].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nightRows(quote).map((row) => (
              <tr key={row.date} data-testid={`night-row-${row.date}`}>
                <td className="ph-tabular">{calendarDate(row.date, locale)}</td>
                <td className="ph-tabular">{formatMoney(row.basePrice)}</td>
                <td className="ph-tabular" style={{ fontWeight: 600 }}>
                  {formatMoney(row.nightlyPrice)}
                </td>
                <td>{row.clamped ? t('guest.rooms.flag.clamped') : t('guest.rooms.flag.none')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p role="note" style={{ margin: 0, fontSize: 13, color: 'var(--color-textMuted)' }}>
        {t('guest.rooms.nights.note')}
      </p>
    </div>
  );
}

export function QuoteSummary({ quote }: { quote: Quote }): ReactElement {
  const t = useT();
  const rows: readonly (readonly [string, string])[] = [
    [t('guest.rooms.summary.subtotal'), formatMoney(quote.subtotal)],
    [t('guest.rooms.summary.discount'), formatMoney(quote.discountAmount)],
    [t('guest.rooms.summary.total'), formatMoney(quote.total)],
    [
      t('guest.rooms.summary.deposit'),
      `${formatMoney(quote.depositAmount)} (${quote.depositPercent}%)`,
    ],
    [t('guest.rooms.summary.quotedAt'), formatDateTimeVn(quote.quotedAt)],
    [t('guest.rooms.summary.expiresAt'), formatDateTimeVn(quote.expiresAt)],
  ];
  return (
    <div className="ph-card">
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>{t('guest.rooms.summaryHeading')}</h2>
      <ul data-testid="quote-summary" className="ph-list-lines ph-tabular">
        {rows.map(([label, value]) => (
          <li key={label}>
            <span style={{ color: 'var(--color-textMuted)', fontSize: 14 }}>{label}</span>
            <strong style={{ fontWeight: 600, textAlign: 'right' }}>{value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function QuoteWarnings({ quote }: { quote: Quote }): ReactElement | null {
  if (quote.warnings.length === 0) return null;
  return (
    <ul
      data-testid="quote-warnings"
      className="ph-muted-box"
      style={{ margin: 0, paddingLeft: 32 }}
    >
      {quote.warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}
