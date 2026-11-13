'use client';

/** Phần trình bày SCR-37 (HB-109): tóm tắt công nợ, biểu mẫu thu tiền, biên lai. */
import type { CSSProperties, ReactElement } from 'react';
import {
  color,
  fontFamily,
  formatDateTimeVn,
  formatMoney,
  radius,
  space,
  typography,
} from '@pinehill/ui-web';
import type { BookingBalance, BookingSummary, Payment } from '@pinehill/contracts';
import { t } from '../../../../../lib/i18n';
import {
  COLLECT_METHODS,
  COLLECT_METHOD_KEYS,
  COLLECT_TYPES,
  COLLECT_TYPE_KEYS,
  receiptLines,
  type AmountIssue,
  type CollectMethod,
  type CollectType,
} from './collect-model';

export { PinDialog } from './collect-pin-dialog';

const CELL: CSSProperties = {
  padding: `${space.s2}px ${space.s3}px ${space.s2}px 0`,
  textAlign: 'left',
};

const FIELD_LABEL: CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 13,
  fontWeight: 500,
  color: color.text,
};

const ALERT_LINE: CSSProperties = {
  margin: 0,
  color: color.danger,
  fontSize: 13,
};

export function BookingSummaryCard({
  booking,
  balance,
}: {
  booking: BookingSummary;
  balance: BookingBalance;
}): ReactElement {
  return (
    <section className="ph-card" style={{ display: 'grid', gap: space.s4 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <p
          data-testid="collect-booking"
          style={{ margin: 0, fontFamily: fontFamily.sans, fontSize: typography.h2.web }}
        >
          {t('ops.collect.booking', { code: booking.code, status: booking.status })}
        </p>
        <p
          data-testid="collect-balance"
          style={{
            margin: 0,
            color: color.textMuted,
            fontSize: 14,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {t('ops.collect.balance', {
            paid: formatMoney(balance.paidAmount),
            due: formatMoney(balance.balanceDue),
          })}
        </p>
      </div>
      <ul className="ph-list-lines" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <li>
          <span style={{ color: color.textMuted }}>{t('ops.bookings.col.code')}</span>
          <strong>{booking.code}</strong>
        </li>
        <li>
          <span style={{ color: color.textMuted }}>{t('ops.bookings.col.stay')}</span>
          <span>
            {booking.checkIn} → {booking.checkOut} ({booking.nights})
          </span>
        </li>
        <li>
          <span style={{ color: color.textMuted }}>{t('ops.bookings.col.money')}</span>
          <span>{formatMoney(balance.totalAmount)}</span>
        </li>
        <li>
          <span style={{ color: color.textMuted }}>{t('ops.bookings.col.paid')}</span>
          <span style={{ color: color.success }}>{formatMoney(balance.paidAmount)}</span>
        </li>
        <li>
          <span style={{ color: color.textMuted }}>{t('ops.bookings.col.balance')}</span>
          <strong style={{ fontSize: 18, color: color.text }}>
            {formatMoney(balance.balanceDue)}
          </strong>
        </li>
      </ul>
    </section>
  );
}

export function CollectForm({
  type,
  method,
  amount,
  suggested,
  note,
  issue,
  pinReady,
  busy,
  onType,
  onMethod,
  onAmount,
  onNote,
  onSend,
}: {
  type: CollectType;
  method: CollectMethod;
  amount: string;
  suggested: number;
  note: string;
  issue: AmountIssue | null;
  pinReady: boolean;
  busy: boolean;
  onType: (value: CollectType) => void;
  onMethod: (value: CollectMethod) => void;
  onAmount: (value: string) => void;
  onNote: (value: string) => void;
  onSend: () => void;
}): ReactElement {
  const issueKey =
    issue === 'FORMAT'
      ? 'ops.collect.issue.FORMAT'
      : issue === 'POSITIVE'
        ? 'ops.collect.issue.POSITIVE'
        : 'ops.collect.issue.OVER';
  return (
    <div data-testid="collect-form" style={{ display: 'grid', gap: space.s3 }}>
      <label style={FIELD_LABEL}>
        {t('ops.collect.type')}
        <select
          name="type"
          value={type}
          disabled={busy}
          onChange={(event) => {
            const value = COLLECT_TYPES.find((item) => item === event.target.value);
            if (value !== undefined) onType(value);
          }}
        >
          {COLLECT_TYPES.map((item) => (
            <option key={item} value={item}>
              {t(COLLECT_TYPE_KEYS[item])}
            </option>
          ))}
        </select>
      </label>
      <label style={FIELD_LABEL}>
        {t('ops.collect.method')}
        <select
          name="method"
          value={method}
          disabled={busy}
          onChange={(event) => {
            const value = COLLECT_METHODS.find((item) => item === event.target.value);
            if (value !== undefined) onMethod(value);
          }}
        >
          {COLLECT_METHODS.map((item) => (
            <option key={item} value={item}>
              {t(COLLECT_METHOD_KEYS[item])}
            </option>
          ))}
        </select>
      </label>
      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: color.textMuted,
          fontVariantNumeric: 'tabular-nums',
        }}
        data-testid="collect-suggested"
      >
        {t('ops.collect.suggested', { amount: formatMoney(suggested) })}
      </p>
      <label style={FIELD_LABEL}>
        {t('ops.collect.amount')}
        <input
          name="amount"
          inputMode="numeric"
          value={amount}
          disabled={busy}
          style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}
          onChange={(event) => {
            onAmount(event.target.value);
          }}
        />
      </label>
      {issue === null ? null : (
        <p role="alert" data-testid="collect-issue" style={ALERT_LINE}>
          {t(issueKey)}
        </p>
      )}
      <label style={FIELD_LABEL}>
        {t('ops.collect.note')}
        <input
          name="note"
          maxLength={500}
          value={note}
          disabled={busy}
          onChange={(event) => {
            onNote(event.target.value);
          }}
        />
      </label>
      {pinReady ? null : (
        <p
          role="status"
          data-testid="pin-required"
          style={{
            margin: 0,
            padding: `${space.s2}px ${space.s3}px`,
            background: '#FDF8EF',
            border: `1px solid ${color.border}`,
            boxShadow: `inset 0 0 0 1px ${color.warning}`,
            borderRadius: radius.sm,
            color: color.warning,
            fontSize: 13,
          }}
        >
          {t('ops.collect.pin.required')}
        </p>
      )}
      <p style={{ margin: 0, fontSize: 13, color: color.textMuted }}>{t('ops.collect.noCard')}</p>
      <button
        type="button"
        data-testid="collect-send"
        className="ph-btn-primary"
        disabled={busy || !pinReady}
        onClick={onSend}
      >
        {t('ops.collect.send')}
      </button>
    </div>
  );
}

export function Receipt({
  payment,
  onPrint,
}: {
  payment: Payment;
  onPrint: () => void;
}): ReactElement {
  return (
    <section
      data-testid="collect-receipt"
      aria-labelledby="ops-collect-receipt-title"
      className="ph-card"
      style={{ display: 'grid', gap: space.s4 }}
    >
      <h2
        id="ops-collect-receipt-title"
        style={{ margin: 0, fontFamily: fontFamily.sans, fontSize: typography.h2.web }}
      >
        {t('ops.collect.receipt.title')}
      </h2>
      <table style={{ fontVariantNumeric: 'tabular-nums' }}>
        <tbody>
          {receiptLines(payment).map((line) => (
            <tr key={line.key}>
              <th scope="row" style={CELL}>
                {t(line.key)}
              </th>
              <td style={CELL}>{line.value}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" style={CELL}>
              {t('ops.collect.receipt.paidAt')}
            </th>
            <td style={CELL}>{payment.paidAt === null ? '—' : formatDateTimeVn(payment.paidAt)}</td>
          </tr>
        </tbody>
      </table>
      <button
        type="button"
        data-testid="collect-print"
        className="ph-btn-primary"
        onClick={onPrint}
      >
        {t('ops.collect.print')}
      </button>
    </section>
  );
}
