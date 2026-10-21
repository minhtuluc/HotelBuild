/**
 * Phần trình bày của SCR-82 (HB-114): bảng chênh lệch giá kỳ mới và kết quả đổi ngày.
 *
 * Mọi con số là nguyên văn máy chủ trả (báo giá `POST /quotes`, booking sau khi đổi); phí đổi ngày không
 * có trong hợp đồng nên màn hình nói rõ thay vì bịa số 0 (ADR-018).
 */
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { color, space } from '@pinehill/ui-native';
import type { BookingSummary, Quote } from '@pinehill/contracts';
import { t } from './strings';
import { formatVnd } from './search';
import { calendarDateLabel } from './calendar-date';
import { ORDER_STATUS_KEYS, stayOf } from './orders';
import { nightsBetween, stayDifference } from './reschedule';

const DIFF_KEYS = {
  more: 'booking.reschedule.diff.more',
  less: 'booking.reschedule.diff.less',
  same: 'booking.reschedule.diff.same',
} as const;

function money(amount: number): string {
  return t('orders.money', { amount: formatVnd(amount) });
}

export function DiffPanel({
  currentTotal,
  quote,
  checkIn,
  checkOut,
}: {
  currentTotal: number;
  quote: Quote;
  checkIn: string;
  checkOut: string;
}): ReactElement {
  const nights = nightsBetween(checkIn, checkOut) ?? 0;
  const difference = stayDifference(quote.total, currentTotal);
  return (
    <View style={{ gap: space.s1 }} data-testid="reschedule-diff">
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {t('booking.reschedule.diffTitle')}
      </Text>
      <Text style={{ color: color.text }} data-testid="reschedule-new-stay">
        {t('booking.reschedule.newStay', {
          checkIn: calendarDateLabel(checkIn),
          checkOut: calendarDateLabel(checkOut),
          nights,
        })}
      </Text>
      <Text style={{ color: color.text }} data-testid="reschedule-new-total">
        {t('booking.reschedule.newTotal', { amount: money(quote.total) })}
      </Text>
      <Text style={{ color: color.textMuted }}>
        {t('booking.reschedule.currentTotal', { amount: money(currentTotal) })}
      </Text>
      <Text style={{ color: color.text }} data-testid="reschedule-difference">
        {t(DIFF_KEYS[difference.kind], { amount: money(difference.amount) })}
      </Text>
      <Text style={{ color: color.textMuted }} data-testid="reschedule-fee">
        {t('booking.reschedule.feeUnknown')}
      </Text>
    </View>
  );
}

export function ResultPanel({ booking }: { booking: BookingSummary }): ReactElement {
  return (
    <View style={{ gap: space.s1 }} data-testid="reschedule-result">
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {t('booking.reschedule.resultTitle')}
      </Text>
      <Text style={{ color: color.text }} data-testid="reschedule-result-status">
        {t('booking.reschedule.resultStatus', { status: t(ORDER_STATUS_KEYS[booking.status]) })}
      </Text>
      <Text style={{ color: color.text }}>{stayOf(booking)}</Text>
      <Text style={{ color: color.text }}>
        {t('booking.reschedule.resultTotal', { amount: money(booking.totalAmount) })}
      </Text>
      <Text style={{ color: color.text }} data-testid="reschedule-result-count">
        {t('booking.reschedule.resultCount', { count: booking.rescheduleCount })}
      </Text>
    </View>
  );
}
