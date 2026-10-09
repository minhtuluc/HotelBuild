'use client';

/** Bảng giá từng đêm và tổng hợp của SCR-03 — in nguyên số `POST /quotes` trả (BR-RATE-17). */
import type { ReactElement } from 'react';
import { formatDateTimeVn, formatMoney } from '@pinehill/ui-web';
import type { Quote } from '@pinehill/contracts';
import { t } from '../../../../lib/i18n';
import { nightRows } from './quote-model';

const CELL = { textAlign: 'start', borderBottom: '1px solid var(--color-border)' } as const;

export function NightsTable({ quote }: { quote: Quote }): ReactElement {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="nights-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
          {t('guest.rooms.nights.title')}
        </caption>
        <thead>
          <tr>
            {[
              t('guest.rooms.col.date'),
              t('guest.rooms.col.basePrice'),
              t('guest.rooms.col.nightlyPrice'),
              t('guest.rooms.col.flags'),
            ].map((label) => (
              <th key={label} scope="col" style={CELL}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nightRows(quote).map((row) => (
            <tr key={row.date} data-testid={`night-row-${row.date}`}>
              <td style={CELL}>{row.date}</td>
              <td style={CELL}>{formatMoney(row.basePrice)}</td>
              <td style={CELL}>{formatMoney(row.nightlyPrice)}</td>
              <td style={CELL}>
                {row.clamped ? t('guest.rooms.flag.clamped') : t('guest.rooms.flag.none')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p role="note" style={{ margin: 0 }}>
        {t('guest.rooms.nights.note')}
      </p>
    </div>
  );
}

export function QuoteSummary({ quote }: { quote: Quote }): ReactElement {
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
    <table data-testid="quote-summary" style={{ borderCollapse: 'collapse' }}>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row" style={{ textAlign: 'start', paddingInlineEnd: 12 }}>
              {label}
            </th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function QuoteWarnings({ quote }: { quote: Quote }): ReactElement | null {
  if (quote.warnings.length === 0) return null;
  return (
    <ul data-testid="quote-warnings" style={{ margin: 0 }}>
      {quote.warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}
