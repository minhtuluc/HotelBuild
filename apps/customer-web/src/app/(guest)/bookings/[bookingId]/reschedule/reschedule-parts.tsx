'use client';

/** Phần trình bày của SCR-12 (HB-104): bảng chênh lệch, biểu mẫu kỳ mới, kết quả đổi ngày. */
import type { ReactElement } from 'react';
import { LocaleLink as Link } from '../../../../../components/locale-link';
import type { BookingSummary, Quote } from '@pinehill/contracts';
import { formatStatusWithEnum } from '@pinehill/ui-web';
import { useMoney, useT, useTranslators } from '../../../../../i18n/client';
import type { CustomerMessageKey } from '../../../../../i18n/catalogs';
import { STATUS_KEYS, stayText } from '../../model';
import { nightsBetween, stayDifference } from '../../reschedule-model';
import { formatStayNights } from '../../stay-format';
import { DateLine } from '../../../../../components/date-line';

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
  const fmtMoney = useMoney();
  const text = useTranslators();
  const t = useT();
  const nights = nightsBetween(checkIn, checkOut) ?? 0;
  const difference = stayDifference(quote.total, booking.totalAmount);
  return (
    <section
      data-testid="reschedule-diff"
      aria-labelledby="reschedule-diff-title"
      className="ph-card"
      style={{ display: 'grid', gap: 12 }}
    >
      <h2 id="reschedule-diff-title" style={{ margin: 0, fontSize: 'var(--text-h2, 18px)' }}>
        {t('guest.reschedule.diff.title')}
      </h2>
      <ul className="ph-list-lines ph-tabular">
        <li data-testid="reschedule-new-stay">
          <span>{formatStayNights(text, checkIn, checkOut, nights)}</span>
        </li>
        <li data-testid="reschedule-new-total">
          <span>{t('guest.reschedule.diff.newTotal', { amount: fmtMoney(quote.total) })}</span>
        </li>
        <li>
          <span>
            {t('guest.reschedule.diff.currentTotal', { amount: fmtMoney(booking.totalAmount) })}
          </span>
        </li>
        <li data-testid="reschedule-difference">
          <strong>{t(DIFF_KEYS[difference.kind], { amount: fmtMoney(difference.amount) })}</strong>
        </li>
      </ul>
      <p
        style={{ margin: 0, fontSize: 13, color: 'var(--color-textMuted)' }}
        data-testid="reschedule-fee"
      >
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
  const fmtMoney = useMoney();
  const text = useTranslators();
  const t = useT();
  return (
    <section
      data-testid="reschedule-result"
      aria-labelledby="reschedule-result-title"
      className="ph-card"
      style={{ display: 'grid', gap: 12 }}
    >
      <h2 id="reschedule-result-title" style={{ margin: 0, fontSize: 'var(--text-h2, 18px)' }}>
        {t('guest.reschedule.result.title')}
      </h2>
      <ul className="ph-list-lines ph-tabular">
        <li data-testid="reschedule-result-status">
          <span>
            {t(
              booking.status === previousStatus
                ? 'guest.reschedule.result.statusSame'
                : 'guest.reschedule.result.statusChanged',
              {
                status: formatStatusWithEnum(t(STATUS_KEYS[booking.status]), booking.status),
              },
            )}
          </span>
        </li>
        <li data-testid="reschedule-result-stay">
          <span>{stayText(text, booking)}</span>
        </li>
        <li>
          <span>
            {t('guest.reschedule.result.total', { amount: fmtMoney(booking.totalAmount) })}
          </span>
        </li>
        <li data-testid="reschedule-result-count">
          <span>{t('guest.reschedule.result.count', { count: booking.rescheduleCount })}</span>
        </li>
      </ul>
      <div>
        <Link href={`/bookings/${booking.id}`} className="ph-btn">
          {t('guest.reschedule.result.back')}
        </Link>
      </div>
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
  const t = useT();
  return (
    <div className="ph-card" style={{ display: 'grid', gap: 16 }}>
      <div className="ph-search-grid">
        <label className="ph-field">
          {t('guest.reschedule.checkIn')}
          <input
            name="checkIn"
            type="date"
            aria-describedby="reschedule-checkIn-line"
            value={checkIn}
            disabled={busy}
            onChange={(event) => {
              onCheckIn(event.target.value);
            }}
          />
          <DateLine id="reschedule-checkIn-line" iso={checkIn} />
        </label>
        <label className="ph-field">
          {t('guest.reschedule.checkOut')}
          <input
            name="checkOut"
            type="date"
            aria-describedby="reschedule-checkOut-line"
            value={checkOut}
            disabled={busy}
            onChange={(event) => {
              onCheckOut(event.target.value);
            }}
          />
          <DateLine id="reschedule-checkOut-line" iso={checkOut} />
        </label>
      </div>
      <label className="ph-field">
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
        <p
          role="alert"
          data-testid="reschedule-issue"
          className="ph-alert-box"
          style={{ margin: 0 }}
        >
          {t(issueKey)}
        </p>
      )}
      {!same ? null : (
        <p
          role="status"
          data-testid="reschedule-same"
          className="ph-muted-box"
          style={{ margin: 0 }}
        >
          {t('guest.reschedule.issue.same')}
        </p>
      )}

      <p style={{ margin: 0, fontSize: 14, color: 'var(--color-textMuted)' }}>
        {t('guest.reschedule.checkRequired')}
      </p>
      <div className="ph-actions">
        <button
          type="button"
          data-testid="reschedule-check"
          className="ph-btn"
          disabled={busy || issueKey !== null || same}
          onClick={onCheck}
        >
          {t('guest.reschedule.check')}
        </button>
        <button
          type="button"
          data-testid="reschedule-confirm"
          className="ph-btn-accent"
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
