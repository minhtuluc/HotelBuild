'use client';

/**
 * Các khối trình bày tách từ `booking-result-screen.tsx` để giữ dung lượng tệp gọn và dễ bảo trì.
 */
import type { ReactElement } from 'react';
import type { BookingSummary } from '@pinehill/contracts';
import { formatDateTimeVn, formatMoney } from '@pinehill/ui-web';
import { stayText } from '../../bookings/model';
import { useT, useTranslators } from '../../../../i18n/client';
import type { CustomerMessageKey } from '../../../../i18n/catalogs';
import { formatCountdown, moneyRows, type HoldView, type MoneyRow } from '../booking-model';

const MONEY_KEYS: Readonly<Record<MoneyRow['key'], CustomerMessageKey>> = {
  total: 'guest.booking.money.total',
  deposit: 'guest.booking.money.deposit',
  paid: 'guest.booking.money.paid',
  penalty: 'guest.booking.money.penalty',
  balance: 'guest.booking.money.balance',
};

/** Dòng hiển thị đồng hồ giữ chỗ theo mốc `holdExpiresAt` từ máy chủ. */
export function HoldLine({ hold }: { hold: HoldView }): ReactElement {
  const t = useT();
  if (hold.kind === 'active') {
    const expires = hold.expiresAt === null ? '' : formatDateTimeVn(hold.expiresAt);
    return (
      <div data-testid="booking-hold" className="ph-muted-box ph-tabular">
        <span>
          {t('guest.booking.hold.counting')}{' '}
          <strong
            data-testid="booking-countdown"
            style={{ fontSize: 18, color: 'var(--color-primary)' }}
          >
            {formatCountdown(hold.remainingMs)}
          </strong>
        </span>
        <span
          data-testid="booking-hold-expires"
          style={{ fontSize: 14, color: 'var(--color-textMuted)' }}
        >
          {t('guest.booking.hold.expiresAt', { time: expires })}
        </span>
      </div>
    );
  }
  const text =
    hold.kind === 'expired'
      ? t('guest.booking.hold.expired', {
          time: hold.expiresAt === null ? '' : formatDateTimeVn(hold.expiresAt),
        })
      : t('guest.booking.hold.none');
  return (
    <p role="status" data-testid="booking-hold" className="ph-alert-box" style={{ margin: 0 }}>
      {text}
    </p>
  );
}

/** Kỳ ở hiển thị ở màn kết quả (SCR-07): ngày lịch dd/MM/yyyy qua helper dùng chung. */
export function StayTable({ booking }: { booking: BookingSummary }): ReactElement {
  const text = useTranslators();
  const t = useT();
  return (
    <div className="ph-table-wrap">
      <table data-testid="booking-stay">
        <caption
          style={{
            textAlign: 'start',
            padding: '14px 16px',
            fontFamily: 'var(--font-display)',
            fontSize: 18,
          }}
        >
          {t('guest.booking.stay')}
        </caption>
        <tbody>
          <tr>
            <th scope="row">{t('guest.booking.stay.period')}</th>
            <td className="ph-tabular">{stayText(text, booking)}</td>
          </tr>
          <tr>
            <th scope="row">{t('guest.booking.stay.rooms')}</th>
            <td className="ph-tabular">{booking.roomCount}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Bảng tóm tắt số tiền đặt phòng (tổng, đặt cọc, đã trả, phạt, còn lại). */
export function MoneyTable({ booking }: { booking: BookingSummary }): ReactElement {
  const t = useT();
  return (
    <div className="ph-table-wrap">
      <table data-testid="booking-money">
        <caption
          style={{
            textAlign: 'start',
            padding: '14px 16px',
            fontFamily: 'var(--font-display)',
            fontSize: 18,
          }}
        >
          {t('guest.booking.money')}
        </caption>
        <tbody>
          {moneyRows(booking).map((row) => (
            <tr key={row.key}>
              <th scope="row">
                {row.key === 'deposit'
                  ? t(MONEY_KEYS[row.key], { percent: booking.depositPercent })
                  : t(MONEY_KEYS[row.key])}
              </th>
              <td className="ph-tabular">{formatMoney(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Danh sách cờ trạng thái đặc biệt của booking (bán quá số lượng, nghi trùng, khoá giá). */
export function FlagsList({ booking }: { booking: BookingSummary }): ReactElement | null {
  const t = useT();
  const flags = [
    booking.oversold ? t('guest.booking.flag.oversold') : null,
    booking.duplicateSuspected ? t('guest.booking.flag.duplicate') : null,
    booking.priceLocked ? t('guest.booking.flag.priceLocked') : null,
  ].filter((flag): flag is string => flag !== null);
  if (flags.length === 0) return null;
  return (
    <ul data-testid="booking-flags" className="ph-muted-box" style={{ margin: 0, paddingLeft: 32 }}>
      {flags.map((flag) => (
        <li key={flag}>{flag}</li>
      ))}
    </ul>
  );
}

/** Khối xác nhận của màn kết quả (SCR-07): kỳ ở hiển thị ngày lịch dd/MM/yyyy qua helper dùng chung. */
export function ConfirmationBlock({ booking }: { booking: BookingSummary }): ReactElement {
  const text = useTranslators();
  const t = useT();
  return (
    <section
      data-testid="booking-confirmation"
      className="ph-card"
      style={{ display: 'grid', gap: 12 }}
    >
      <h2 style={{ margin: 0, fontSize: 'var(--text-h2, 18px)' }}>
        {t('guest.booking.confirmation')}
      </h2>
      <ul className="ph-list-lines ph-tabular">
        <li>
          <span style={{ color: 'var(--color-textMuted)' }}>{t('guest.booking.code')}</span>
          <code>{booking.code}</code>
        </li>
        <li>
          <span style={{ color: 'var(--color-textMuted)' }}>{t('guest.booking.stay')}</span>
          <span>{stayText(text, booking)}</span>
        </li>
        <li>
          <span style={{ color: 'var(--color-textMuted)' }}>{t('guest.booking.money.total')}</span>
          <strong>{formatMoney(booking.totalAmount)}</strong>
        </li>
        <li>
          <span style={{ color: 'var(--color-textMuted)' }}>
            {t('guest.booking.money.balance')}
          </span>
          <strong>{formatMoney(booking.balanceDue)}</strong>
        </li>
        <li>
          <span style={{ color: 'var(--color-textMuted)' }}>{t('guest.booking.created')}</span>
          <span>{formatDateTimeVn(booking.createdAt)}</span>
        </li>
      </ul>
    </section>
  );
}
