'use client';

/** Phần trình bày của SCR-12 (HB-104): bảng chênh lệch, biểu mẫu kỳ mới, kết quả đổi ngày. */
import type { ReactElement } from 'react';
import Link from 'next/link';
import type { BookingSummary, Quote } from '@pinehill/contracts';
import { formatMoney, formatStatusWithEnum, formatStayPeriod } from '@pinehill/ui-web';
import { t, type CustomerMessageKey } from '../../../../../lib/i18n';
import { STATUS_KEYS } from '../../model';
import { nightsBetween, stayDifference } from '../../reschedule-model';

const DIFF_KEYS = {
  more: 'guest.reschedule.diff.more',
  less: 'guest.reschedule.diff.less',
  same: 'guest.reschedule.diff.same',
} as const;

function QuoteDiff({
  booking,
  quote,
  checkIn,
  checkOut,
}: {
  booking: BookingSummary;
  quote: Quote;
  checkIn: string;
  checkOut: string;
}): ReactElement {
  const nights = nightsBetween(checkIn, checkOut) ?? 0;
  const difference = stayDifference(quote.total, booking.totalAmount);
  return (
    <section
      data-testid="reschedule-diff"
      aria-labelledby="reschedule-diff-title"
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}
    >
      <h2 id="reschedule-diff-title" style={{ margin: 0 }}>
        {t('guest.reschedule.diff.title')}
      </h2>
      <p style={{ margin: 0 }} data-testid="reschedule-new-stay">
        {checkIn} → {checkOut} · {nights} đêm
      </p>
      <p style={{ margin: 0 }} data-testid="reschedule-new-total">
        {t('guest.reschedule.diff.newTotal', { amount: formatMoney(quote.total) })}
      </p>
      <p style={{ margin: 0 }}>
        {t('guest.reschedule.diff.currentTotal', { amount: formatMoney(booking.totalAmount) })}
      </p>
      <p style={{ margin: 0 }} data-testid="reschedule-difference">
        {t(DIFF_KEYS[difference.kind], { amount: formatMoney(difference.amount) })}
      </p>
      <p style={{ margin: 0 }} data-testid="reschedule-fee">
        {t('guest.reschedule.feeUnknown')}
      </p>
    </section>
  );
}

function RescheduleResult({
  previousStatus,
  booking,
}: {
  previousStatus: string;
  booking: BookingSummary;
}): ReactElement {
  return (
    <section
      data-testid="reschedule-result"
      aria-labelledby="reschedule-result-title"
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}
    >
      <h2 id="reschedule-result-title" style={{ margin: 0 }}>
        {t('guest.reschedule.result.title')}
      </h2>
      <p style={{ margin: 0 }} data-testid="reschedule-result-status">
        {t(
          booking.status === previousStatus
            ? 'guest.reschedule.result.statusSame'
            : 'guest.reschedule.result.statusChanged',
          {
            status: formatStatusWithEnum(t(STATUS_KEYS[booking.status]), booking.status),
          },
        )}
      </p>
      <p style={{ margin: 0 }} data-testid="reschedule-result-stay">
        {booking.checkIn} → {booking.checkOut} ·{' '}
        {formatStayPeriod(booking.nights, booking.adults, booking.children)}
      </p>
      <p style={{ margin: 0 }}>
        {t('guest.reschedule.result.total', { amount: formatMoney(booking.totalAmount) })}
      </p>
      <p style={{ margin: 0 }} data-testid="reschedule-result-count">
        {t('guest.reschedule.result.count', { count: booking.rescheduleCount })}
      </p>
      <Link href={`/bookings/${booking.id}`}>{t('guest.reschedule.result.back')}</Link>
    </section>
  );
}

export function RescheduleForm({
  checkIn,
  checkOut,
  note,
  busy,
  issueKey,
  same,
  confirmEnabled,
  onCheckIn,
  onCheckOut,
  onNote,
  onCheck,
  onConfirm,
}: {
  checkIn: string;
  checkOut: string;
  note: string;
  busy: boolean;
  issueKey: CustomerMessageKey | null;
  same: boolean;
  confirmEnabled: boolean;
  onCheckIn: (value: string) => void;
  onCheckOut: (value: string) => void;
  onNote: (value: string) => void;
  onCheck: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('guest.reschedule.checkIn')}
        <input
          name="checkIn"
          type="date"
          value={checkIn}
          disabled={busy}
          onChange={(event) => {
            onCheckIn(event.target.value);
          }}
        />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('guest.reschedule.checkOut')}
        <input
          name="checkOut"
          type="date"
          value={checkOut}
          disabled={busy}
          onChange={(event) => {
            onCheckOut(event.target.value);
          }}
        />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('guest.reschedule.note')}
        <input
          name="reason"
          maxLength={500}
          value={note}
          disabled={busy}
          onChange={(event) => {
            onNote(event.target.value);
          }}
        />
      </label>

      {issueKey === null ? null : (
        <p role="alert" data-testid="reschedule-issue" style={{ margin: 0 }}>
          {t(issueKey)}
        </p>
      )}
      {!same ? null : (
        <p role="status" data-testid="reschedule-same" style={{ margin: 0 }}>
          {t('guest.reschedule.issue.same')}
        </p>
      )}

      <p style={{ margin: 0 }}>{t('guest.reschedule.checkRequired')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="reschedule-check"
          disabled={busy || issueKey !== null || same}
          onClick={onCheck}
        >
          {t('guest.reschedule.check')}
        </button>
        <button
          type="button"
          data-testid="reschedule-confirm"
          disabled={busy || !confirmEnabled}
          onClick={onConfirm}
        >
          {t('guest.reschedule.confirm')}
        </button>
      </div>
    </div>
  );
}

export function RescheduleOutcome({
  baseline,
  booking,
  quote,
  result,
  checkIn,
  checkOut,
}: {
  baseline: BookingSummary | null;
  booking: BookingSummary | null;
  quote: Quote | null;
  result: BookingSummary | null;
  checkIn: string;
  checkOut: string;
}): ReactElement | null {
  if (result !== null && baseline !== null)
    return <RescheduleResult previousStatus={baseline.status} booking={result} />;
  if (quote === null || booking === null) return null;
  return <QuoteDiff booking={booking} quote={quote} checkIn={checkIn} checkOut={checkOut} />;
}
